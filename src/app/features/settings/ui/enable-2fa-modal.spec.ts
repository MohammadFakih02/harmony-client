import { TestBed } from '@angular/core/testing';
import { Enable2faModal } from './enable-2fa-modal';
import { AuthService } from '../../../core/services/auth.service';

describe('Enable2faModal', () => {
  let component: Enable2faModal;
  // Angular templates can read `protected` members but plain TS (including this spec) can't —
  // this alias reaches in the same way the component's own template does.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let internal: any;
  let auth: { enable2faRequest: ReturnType<typeof vi.fn>; enable2faConfirm: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = { enable2faRequest: vi.fn(), enable2faConfirm: vi.fn() };

    TestBed.configureTestingModule({
      imports: [Enable2faModal],
      providers: [{ provide: AuthService, useValue: auth }],
    });

    component = TestBed.createComponent(Enable2faModal).componentInstance;
    internal = component;
  });

  it('sendCode() requests a setup code and advances to the code step', async () => {
    auth.enable2faRequest.mockResolvedValue(undefined);
    internal.password.set('Password123!');

    await component.sendCode();

    expect(auth.enable2faRequest).toHaveBeenCalledWith('Password123!');
    expect(internal.codeSent()).toBe(true);
    expect(internal.resendCooldown()).toBe(60);
  });

  it('sendCode() surfaces an error and stays on the password step when the password is wrong', async () => {
    auth.enable2faRequest.mockRejectedValue({ status: 401, error: { error: 'Invalid credentials.' } });
    internal.password.set('WrongPassword!');

    await component.sendCode();

    expect(internal.codeSent()).toBe(false);
    expect(internal.error()).toBeTruthy();
  });

  it('confirmCode() confirms the code and emits enabled', async () => {
    auth.enable2faConfirm.mockResolvedValue(undefined);
    const enabled = vi.fn();
    component.enabled.subscribe(enabled);
    internal.code.set('123456');

    await component.confirmCode();

    expect(auth.enable2faConfirm).toHaveBeenCalledWith('123456');
    expect(enabled).toHaveBeenCalled();
  });

  it('confirmCode() surfaces an error and does not emit enabled on an invalid code', async () => {
    auth.enable2faConfirm.mockRejectedValue({ status: 400, error: { error: 'Invalid code.' } });
    const enabled = vi.fn();
    component.enabled.subscribe(enabled);
    internal.code.set('000000');

    await component.confirmCode();

    expect(enabled).not.toHaveBeenCalled();
    expect(internal.error()).toBeTruthy();
  });
});
