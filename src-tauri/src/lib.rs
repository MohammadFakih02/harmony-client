use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  Manager, WindowEvent,
};

/// Desktop preferences mirrored from the frontend. `close_to_tray` decides whether closing the
/// window hides Harmony to the tray (default, Discord-style) or actually quits. The frontend
/// pushes the persisted choice via `set_close_to_tray` at boot and on every toggle.
struct DesktopState {
  close_to_tray: AtomicBool,
}

#[tauri::command]
fn set_close_to_tray(enabled: bool, state: tauri::State<DesktopState>) {
  state.close_to_tray.store(enabled, Ordering::Relaxed);
}

/// Reflects the total unread count in the OS chrome: the tray tooltip everywhere, plus a red badge
/// with the number overlaid on the taskbar button on Windows (Discord-style). `count == 0` clears both.
#[tauri::command]
fn set_unread(count: u32, app: tauri::AppHandle) {
  if let Some(tray) = app.tray_by_id("main-tray") {
    let tooltip = if count > 0 {
      format!("Harmony \u{2014} {} unread", count)
    } else {
      "Harmony".to_string()
    };
    let _ = tray.set_tooltip(Some(tooltip.as_str()));
  }

  #[cfg(target_os = "windows")]
  if let Some(window) = app.get_webview_window("main") {
    let _ = if count > 0 {
      window.set_overlay_icon(Some(badge_image(count)))
    } else {
      window.set_overlay_icon(None)
    };
  }
}

/// Curated executable → display-name map for "Playing X" rich presence. Deliberately small and
/// easy to extend; matched case-insensitively against running process names. (Generic runtimes
/// like javaw.exe are omitted to avoid false positives.)
const GAMES: &[(&str, &str)] = &[
  ("cs2.exe", "Counter-Strike 2"),
  ("csgo.exe", "Counter-Strike"),
  ("valorant.exe", "VALORANT"),
  ("valorant-win64-shipping.exe", "VALORANT"),
  ("leagueclient.exe", "League of Legends"),
  ("league of legends.exe", "League of Legends"),
  ("dota2.exe", "Dota 2"),
  ("gta5.exe", "Grand Theft Auto V"),
  ("fortniteclient-win64-shipping.exe", "Fortnite"),
  ("overwatch.exe", "Overwatch 2"),
  ("rocketleague.exe", "Rocket League"),
  ("eldenring.exe", "ELDEN RING"),
  ("cyberpunk2077.exe", "Cyberpunk 2077"),
  ("witcher3.exe", "The Witcher 3"),
  ("hades.exe", "Hades"),
  ("hades2.exe", "Hades II"),
  ("factorio.exe", "Factorio"),
  ("terraria.exe", "Terraria"),
  ("stardew valley.exe", "Stardew Valley"),
  ("hollow_knight.exe", "Hollow Knight"),
  ("bg3.exe", "Baldur's Gate 3"),
  ("bg3_dx11.exe", "Baldur's Gate 3"),
];

/// Scans running processes and returns the display name of the first recognized game, or `None`.
/// Called by the frontend on a timer while "game activity" is enabled.
#[tauri::command]
fn detected_game() -> Option<String> {
  // Refresh only the process list (names) — not the CPU/memory/disk/network/etc. that new_all() loads.
  let mut system = sysinfo::System::new();
  system.refresh_processes(sysinfo::ProcessesToUpdate::All, false);
  for process in system.processes().values() {
    let name = process.name().to_string_lossy().to_ascii_lowercase();
    if let Some((_, display)) = GAMES.iter().find(|(exe, _)| name.as_str() == *exe) {
      return Some((*display).to_string());
    }
  }
  None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();

  // Single instance MUST be the first plugin: a second launch is intercepted here and focuses the
  // existing window instead of opening another copy (also the entry point for future deep links).
  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      show_main_window(app);
    }));
  }

  builder
    .plugin(tauri_plugin_notification::init())
    .manage(DesktopState {
      close_to_tray: AtomicBool::new(true),
    })
    .invoke_handler(tauri::generate_handler![
      set_close_to_tray,
      set_unread,
      detected_game
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Desktop-only plugins. Global shortcuts (mute/deafen) are registered from the frontend via
      // the JS bindings; autostart launches Harmony with `--minimized` so it starts hidden in the
      // tray (see the show-window step below).
      #[cfg(desktop)]
      {
        app
          .handle()
          .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
        app.handle().plugin(tauri_plugin_autostart::init(
          tauri_plugin_autostart::MacosLauncher::LaunchAgent,
          Some(vec!["--minimized"]),
        ))?;
      }

      // System tray (desktop). Discord-style: closing the window hides it to the
      // tray (see the CloseRequested handler below) and the app keeps running;
      // left-click restores the window, right-click opens the menu, and "Quit"
      // is the only path that actually exits the process.
      let open_i = MenuItem::with_id(app, "open", "Open Harmony", true, None::<&str>)?;
      let quit_i = MenuItem::with_id(app, "quit", "Quit Harmony", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&open_i, &quit_i])?;

      TrayIconBuilder::with_id("main-tray")
        .tooltip("Harmony")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "open" => show_main_window(app),
          "quit" => app.exit(0),
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            show_main_window(tray.app_handle());
          }
        })
        .build(app)?;

      // The window starts hidden (tauri.conf.json `visible: false`). Show it now UNLESS launched
      // with --minimized (autostart) — then it stays in the tray until the user opens it. Doing
      // this in Rust (not JS) means a broken webview can't leave the window permanently invisible.
      if !std::env::args().any(|a| a == "--minimized") {
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.show();
          let _ = window.set_focus();
        }
      }

      Ok(())
    })
    .on_window_event(|window, event| {
      // The custom titlebar's X calls window.close(). Honour the "close to tray"
      // preference: hide instead of quitting when enabled; otherwise let the close
      // proceed (the last window closing exits the app). Real exit when hidden goes
      // through the tray "Quit Harmony" item.
      if let WindowEvent::CloseRequested { api, .. } = event {
        let state = window.state::<DesktopState>();
        if state.close_to_tray.load(Ordering::Relaxed) {
          let _ = window.hide();
          api.prevent_close();
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }
}

/// A red rounded badge showing the unread count in white ("9+" past nine) — the Windows taskbar
/// overlay. Rendered to an in-memory RGBA buffer (no icon asset shipped). Windows-only.
#[cfg(target_os = "windows")]
fn badge_image(count: u32) -> tauri::image::Image<'static> {
  const SIZE: u32 = 32;
  let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];

  // Red circle background (#ED4245).
  let center = SIZE as f32 / 2.0;
  let radius = center - 1.0;
  for y in 0..SIZE {
    for x in 0..SIZE {
      let dx = x as f32 + 0.5 - center;
      let dy = y as f32 + 0.5 - center;
      if dx * dx + dy * dy <= radius * radius {
        let i = ((y * SIZE + x) * 4) as usize;
        rgba[i] = 237;
        rgba[i + 1] = 66;
        rgba[i + 2] = 69;
        rgba[i + 3] = 255;
      }
    }
  }

  // White digits, drawn with a 3x5 bitmap font.
  let text: Vec<char> = if count > 9 {
    vec!['9', '+']
  } else {
    count.to_string().chars().collect()
  };
  let n = text.len() as u32;
  let scale = if n <= 1 { 4 } else { 3 };
  let glyph_w = 3 * scale;
  let glyph_h = 5 * scale;
  let gap = scale;
  let total_w = n * glyph_w + (n - 1) * gap;
  let mut ox = (SIZE - total_w) / 2;
  let oy = (SIZE - glyph_h) / 2;

  for ch in text {
    let rows = glyph(ch);
    for (ry, row) in rows.iter().enumerate() {
      for cx in 0..3u32 {
        if row & (0b100 >> cx) != 0 {
          for sy in 0..scale {
            for sx in 0..scale {
              let px = ox + cx * scale + sx;
              let py = oy + ry as u32 * scale + sy;
              let i = ((py * SIZE + px) * 4) as usize;
              rgba[i] = 255;
              rgba[i + 1] = 255;
              rgba[i + 2] = 255;
              rgba[i + 3] = 255;
            }
          }
        }
      }
    }
    ox += glyph_w + gap;
  }

  tauri::image::Image::new_owned(rgba, SIZE, SIZE)
}

/// A digit (or '+') as five rows of 3 bits (MSB = leftmost pixel). Unknown chars render blank.
#[cfg(target_os = "windows")]
fn glyph(c: char) -> [u8; 5] {
  match c {
    '0' => [0b111, 0b101, 0b101, 0b101, 0b111],
    '1' => [0b010, 0b110, 0b010, 0b010, 0b111],
    '2' => [0b111, 0b001, 0b111, 0b100, 0b111],
    '3' => [0b111, 0b001, 0b111, 0b001, 0b111],
    '4' => [0b101, 0b101, 0b111, 0b001, 0b001],
    '5' => [0b111, 0b100, 0b111, 0b001, 0b111],
    '6' => [0b111, 0b100, 0b111, 0b101, 0b111],
    '7' => [0b111, 0b001, 0b010, 0b010, 0b010],
    '8' => [0b111, 0b101, 0b111, 0b101, 0b111],
    '9' => [0b111, 0b101, 0b111, 0b001, 0b111],
    '+' => [0b000, 0b010, 0b111, 0b010, 0b000],
    _ => [0, 0, 0, 0, 0],
  }
}
