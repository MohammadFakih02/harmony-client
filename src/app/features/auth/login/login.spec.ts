import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { LoginComponent } from './login';
import { AuthService } from '../../../core/services/auth.service';

describe('LoginComponent', () => {
  let component: LoginComponent;
  // Angular templates can read `protected` members but plain TS (including this spec) can't —
  // this alias reaches in the same way the component's own template does.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let internal: any;
  let auth: {
    login: ReturnType<typeof vi.fn>;
    verify2fa: ReturnType<typeof vi.fn>;
    resend2fa: ReturnType<typeof vi.fn>;
  };
  let router: { navigateByUrl: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = {
      login: vi.fn(),
      verify2fa: vi.fn(),
      resend2fa: vi.fn(),
    };
    router = { navigateByUrl: vi.fn() };

    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => null } } },
        },
      ],
    });

    component = TestBed.createComponent(LoginComponent).componentInstance;
    internal = component;
  });

  function fillForm(identifier = 'alice', password = 'Password123!'): void {
    component.form.setValue({ identifier, password });
  }

  it('navigates to /app on a normal (non-2FA) login', async () => {
    auth.login.mockResolvedValue({ twoFactorRequired: false });
    fillForm();

    await component.onSubmit();

    expect(auth.login).toHaveBeenCalledWith('alice', 'Password123!');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/app');
  });

  it('shows the code step (and does not navigate) when login returns a 2FA challenge', async () => {
    auth.login.mockResolvedValue({ twoFactorRequired: true, challengeToken: 'chal-1' });
    fillForm();

    await component.onSubmit();

    expect(internal.challengeToken()).toBe('chal-1');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('onVerifyCode() completes the challenge and navigates', async () => {
    auth.login.mockResolvedValue({ twoFactorRequired: true, challengeToken: 'chal-1' });
    auth.verify2fa.mockResolvedValue(undefined);
    fillForm();
    await component.onSubmit();

    internal.code.set('123456');
    await internal.onVerifyCode();

    expect(auth.verify2fa).toHaveBeenCalledWith('chal-1', '123456', false);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/app');
  });

  it('onVerifyCode() surfaces an error and stays on the code step when the code is wrong', async () => {
    auth.login.mockResolvedValue({ twoFactorRequired: true, challengeToken: 'chal-1' });
    auth.verify2fa.mockRejectedValue({
      status: 401,
      error: { error: 'Invalid or expired code.' },
    });
    fillForm();
    await component.onSubmit();

    internal.code.set('000000');
    await internal.onVerifyCode();

    expect(internal.error()).toBeTruthy();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('onResendCode() calls resend2fa for the current challenge', async () => {
    auth.login.mockResolvedValue({ twoFactorRequired: true, challengeToken: 'chal-1' });
    auth.resend2fa.mockResolvedValue(undefined);
    fillForm();
    await component.onSubmit();
    internal.resendCooldown.set(0); // onSubmit already started a cooldown for the first-send code

    await internal.onResendCode();

    expect(auth.resend2fa).toHaveBeenCalledWith('chal-1');
    expect(internal.resendCooldown()).toBe(60);
  });

  it('backToPassword() clears the challenge state', async () => {
    auth.login.mockResolvedValue({ twoFactorRequired: true, challengeToken: 'chal-1' });
    fillForm();
    await component.onSubmit();

    internal.code.set('123456');
    internal.backToPassword();

    expect(internal.challengeToken()).toBeNull();
    expect(internal.code()).toBe('');
  });
});
