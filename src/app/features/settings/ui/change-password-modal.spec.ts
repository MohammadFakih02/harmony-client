import { TestBed } from '@angular/core/testing';
import { ChangePasswordModal } from './change-password-modal';
import { AuthService } from '../../../core/services/auth.service';

describe('ChangePasswordModal', () => {
  let component: ChangePasswordModal;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let internal: any;
  let auth: { changePassword: ReturnType<typeof vi.fn>; setPassword: ReturnType<typeof vi.fn> };

  function create(hasPassword: boolean) {
    const fixture = TestBed.createComponent(ChangePasswordModal);
    fixture.componentRef.setInput('hasPassword', hasPassword);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    auth = { changePassword: vi.fn(), setPassword: vi.fn() };

    TestBed.configureTestingModule({
      imports: [ChangePasswordModal],
      providers: [{ provide: AuthService, useValue: auth }],
    });
  });

  it('submit() calls changePassword when hasPassword is true and emits done', async () => {
    component = create(true);
    internal = component;
    auth.changePassword.mockResolvedValue({ requiresCode: false });
    const done = vi.fn();
    component.done.subscribe(done);

    internal.currentPassword.set('OldPassword123!');
    internal.newPassword.set('NewPassword456!');
    internal.confirmPassword.set('NewPassword456!');

    await component.submit();

    expect(auth.changePassword).toHaveBeenCalledWith(
      'OldPassword123!',
      'NewPassword456!',
      undefined,
    );
    expect(auth.setPassword).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalled();
  });

  it('submit() shows the code step instead of emitting done, when the account is 2FA-enabled', async () => {
    component = create(true);
    internal = component;
    auth.changePassword.mockResolvedValue({ requiresCode: true });
    const done = vi.fn();
    component.done.subscribe(done);

    internal.currentPassword.set('OldPassword123!');
    internal.newPassword.set('NewPassword456!');
    internal.confirmPassword.set('NewPassword456!');

    await component.submit();

    expect(internal.requiresCode()).toBe(true);
    expect(internal.resendCooldown()).toBe(60);
    expect(done).not.toHaveBeenCalled();
  });

  it('submit() forwards the entered code on the follow-up call and emits done on success', async () => {
    component = create(true);
    internal = component;
    auth.changePassword.mockResolvedValueOnce({ requiresCode: true });
    const done = vi.fn();
    component.done.subscribe(done);

    internal.currentPassword.set('OldPassword123!');
    internal.newPassword.set('NewPassword456!');
    internal.confirmPassword.set('NewPassword456!');
    await component.submit();

    auth.changePassword.mockResolvedValueOnce({ requiresCode: false });
    internal.code.set('123456');
    await component.submit();

    expect(auth.changePassword).toHaveBeenLastCalledWith(
      'OldPassword123!',
      'NewPassword456!',
      '123456',
    );
    expect(done).toHaveBeenCalled();
  });

  it('submit() calls setPassword (no current password) when hasPassword is false', async () => {
    component = create(false);
    internal = component;
    auth.setPassword.mockResolvedValue(undefined);
    const done = vi.fn();
    component.done.subscribe(done);

    internal.newPassword.set('NewPassword456!');
    internal.confirmPassword.set('NewPassword456!');

    await component.submit();

    expect(auth.setPassword).toHaveBeenCalledWith('NewPassword456!');
    expect(auth.changePassword).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalled();
  });

  it('canSubmit is false when the passwords do not match', () => {
    component = create(true);
    internal = component;
    internal.currentPassword.set('OldPassword123!');
    internal.newPassword.set('NewPassword456!');
    internal.confirmPassword.set('Mismatch789!');

    expect(internal.canSubmit()).toBe(false);
  });

  it('submit() surfaces an error and does not emit done on a rejected request', async () => {
    component = create(true);
    internal = component;
    auth.changePassword.mockRejectedValue({ status: 401, error: { error: 'Invalid credentials.' } });
    const done = vi.fn();
    component.done.subscribe(done);

    internal.currentPassword.set('WrongPassword!');
    internal.newPassword.set('NewPassword456!');
    internal.confirmPassword.set('NewPassword456!');

    await component.submit();

    expect(done).not.toHaveBeenCalled();
    expect(internal.error()).toBeTruthy();
  });
});
