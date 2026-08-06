import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { ForgotPassword } from './forgot-password';
import { AuthService } from '../../../core/services/auth.service';

describe('ForgotPassword', () => {
  let component: ForgotPassword;
  // Angular templates can read `protected` members but plain TS (including this spec) can't —
  // this alias reaches in the same way the component's own template does.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let internal: any;
  let auth: { forgotPassword: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = { forgotPassword: vi.fn() };

    TestBed.configureTestingModule({
      imports: [ForgotPassword],
      providers: [
        { provide: AuthService, useValue: auth },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => null } } },
        },
      ],
    });

    component = TestBed.createComponent(ForgotPassword).componentInstance;
    internal = component;
  });

  it('onSubmit() sends the email and shows the sent state', async () => {
    auth.forgotPassword.mockResolvedValue(undefined);
    component.form.setValue({ email: 'alice@example.com' });

    await component.onSubmit();

    expect(auth.forgotPassword).toHaveBeenCalledWith('alice@example.com');
    expect(internal.sent()).toBe(true);
  });

  it('onSubmit() shows the sent state even if the request fails (never reveals account existence)', async () => {
    auth.forgotPassword.mockRejectedValue({ status: 502, error: { error: 'boom' } });
    component.form.setValue({ email: 'alice@example.com' });

    await component.onSubmit();

    expect(internal.sent()).toBe(true);
  });

  it('onSubmit() does nothing with an invalid form', async () => {
    component.form.setValue({ email: 'not-an-email' });

    await component.onSubmit();

    expect(auth.forgotPassword).not.toHaveBeenCalled();
    expect(internal.sent()).toBe(false);
  });
});
