import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { ResetPassword } from './reset-password';
import { AuthService } from '../../../core/services/auth.service';

describe('ResetPassword', () => {
  let auth: { resetPassword: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn> };
  let queryParams: Record<string, string | null>;

  function createComponent(): ResetPassword {
    TestBed.configureTestingModule({
      imports: [ResetPassword],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: (key: string) => queryParams[key] ?? null } } },
        },
      ],
    });
    return TestBed.createComponent(ResetPassword).componentInstance;
  }

  beforeEach(() => {
    auth = { resetPassword: vi.fn() };
    router = { navigate: vi.fn() };
    queryParams = { uid: '1', token: 'sometoken' };
  });

  it('shows the invalid-link state when uid/token are missing from the URL', () => {
    queryParams = {};
    const component = createComponent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internal: any = component;

    component.ngOnInit();

    expect(internal.state()).toBe('invalidLink');
  });

  it('onSubmit() resets the password and shows the success state', async () => {
    const component = createComponent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internal: any = component;
    component.ngOnInit();
    auth.resetPassword.mockResolvedValue(undefined);
    component.form.setValue({ password: 'NewPassword456!', confirmPassword: 'NewPassword456!' });

    await component.onSubmit();

    expect(auth.resetPassword).toHaveBeenCalledWith('1', 'sometoken', 'NewPassword456!');
    expect(internal.state()).toBe('success');
  });

  it('onSubmit() surfaces an error and stays on the form when the token is invalid', async () => {
    const component = createComponent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internal: any = component;
    component.ngOnInit();
    auth.resetPassword.mockRejectedValue({ status: 400, error: { error: 'Invalid or expired link.' } });
    component.form.setValue({ password: 'NewPassword456!', confirmPassword: 'NewPassword456!' });

    await component.onSubmit();

    expect(internal.state()).toBe('form');
    expect(component.error()).toBeTruthy();
  });

  it('onSubmit() does nothing when the passwords do not match', async () => {
    const component = createComponent();
    component.ngOnInit();
    component.form.setValue({ password: 'NewPassword456!', confirmPassword: 'Mismatch123!' });

    await component.onSubmit();

    expect(auth.resetPassword).not.toHaveBeenCalled();
  });

  it('goToLogin() navigates to /login', () => {
    const component = createComponent();
    component.goToLogin();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });
});
