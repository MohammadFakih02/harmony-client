import { TestBed } from '@angular/core/testing';
import { ChangeEmailModal } from './change-email-modal';
import { AuthService } from '../../../core/services/auth.service';

describe('ChangeEmailModal', () => {
  let component: ChangeEmailModal;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let internal: any;
  let auth: { requestEmailChange: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = { requestEmailChange: vi.fn() };

    TestBed.configureTestingModule({
      imports: [ChangeEmailModal],
      providers: [{ provide: AuthService, useValue: auth }],
    });

    component = TestBed.createComponent(ChangeEmailModal).componentInstance;
    internal = component;
  });

  it('send() requests the email change and advances to the sent step', async () => {
    auth.requestEmailChange.mockResolvedValue(false);
    internal.password.set('Password123!');
    internal.newEmail.set('new@example.com');

    await component.send();

    expect(auth.requestEmailChange).toHaveBeenCalledWith(
      'Password123!',
      'new@example.com',
      undefined,
    );
    expect(internal.sent()).toBe(true);
    expect(internal.resendCooldown()).toBe(60);
  });

  it('send() shows the code step instead of the sent step, when the account is 2FA-enabled', async () => {
    auth.requestEmailChange.mockResolvedValue(true);
    internal.password.set('Password123!');
    internal.newEmail.set('new@example.com');

    await component.send();

    expect(internal.requiresCode()).toBe(true);
    expect(internal.sent()).toBe(false);
    expect(internal.resendCooldown()).toBe(60);
  });

  it('send() forwards the entered code on the follow-up call and advances to the sent step', async () => {
    auth.requestEmailChange.mockResolvedValueOnce(true);
    internal.password.set('Password123!');
    internal.newEmail.set('new@example.com');
    await component.send();

    auth.requestEmailChange.mockResolvedValueOnce(false);
    internal.code.set('123456');
    await component.send();

    expect(auth.requestEmailChange).toHaveBeenLastCalledWith(
      'Password123!',
      'new@example.com',
      '123456',
    );
    expect(internal.sent()).toBe(true);
  });

  it('send() surfaces an error and stays on the form step when the password is wrong', async () => {
    auth.requestEmailChange.mockRejectedValue({ status: 401, error: { error: 'Invalid credentials.' } });
    internal.password.set('WrongPassword!');
    internal.newEmail.set('new@example.com');

    await component.send();

    expect(internal.sent()).toBe(false);
    expect(internal.error()).toBeTruthy();
  });

  it('send() surfaces a conflict error for an already-in-use email', async () => {
    auth.requestEmailChange.mockRejectedValue({
      status: 409,
      error: { error: 'Email already in use.' },
    });
    internal.password.set('Password123!');
    internal.newEmail.set('taken@example.com');

    await component.send();

    expect(internal.sent()).toBe(false);
    expect(internal.error()).toBeTruthy();
  });
});
