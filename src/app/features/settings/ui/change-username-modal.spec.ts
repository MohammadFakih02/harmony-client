import { TestBed } from '@angular/core/testing';
import { ChangeUsernameModal } from './change-username-modal';
import { AuthService } from '../../../core/services/auth.service';

describe('ChangeUsernameModal', () => {
  let component: ChangeUsernameModal;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let internal: any;
  let auth: { changeUsername: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = { changeUsername: vi.fn() };

    TestBed.configureTestingModule({
      imports: [ChangeUsernameModal],
      providers: [{ provide: AuthService, useValue: auth }],
    });

    component = TestBed.createComponent(ChangeUsernameModal).componentInstance;
    internal = component;
  });

  it('submit() changes the username and emits done', async () => {
    auth.changeUsername.mockResolvedValue(undefined);
    const done = vi.fn();
    component.done.subscribe(done);
    internal.password.set('Password123!');
    internal.newUsername.set('newname');

    await component.submit();

    expect(auth.changeUsername).toHaveBeenCalledWith('Password123!', 'newname');
    expect(done).toHaveBeenCalled();
  });

  it('submit() surfaces a conflict error and does not emit done for a taken name', async () => {
    auth.changeUsername.mockRejectedValue({ status: 409, error: { error: 'Username already taken.' } });
    const done = vi.fn();
    component.done.subscribe(done);
    internal.password.set('Password123!');
    internal.newUsername.set('taken');

    await component.submit();

    expect(done).not.toHaveBeenCalled();
    expect(internal.error()).toBeTruthy();
  });

  it('canSubmit is false without a password', () => {
    internal.newUsername.set('newname');
    expect(internal.canSubmit()).toBe(false);
  });
});
