import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { PushService } from './push.service';
import { environment } from '../../../environments/environment';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  const base = environment.apiUrl;

  const user = {
    id: '1',
    username: 'alice',
    email: 'alice@example.com',
    avatarKey: null,
    accountStatus: 'active',
    emailVerified: false,
    twoFactorEnabled: false,
    hasPassword: true,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: PushService, useValue: { disable: vi.fn().mockResolvedValue(undefined) } },
      ],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('register() sets the session from the response', async () => {
    const promise = service.register('alice', 'alice@example.com', 'Password123!');
    const req = httpMock.expectOne(`${base}/auth/register`);
    expect(req.request.method).toBe('POST');
    req.flush({ accessToken: 'tok1', user });

    await promise;
    expect(service.isAuthenticated()).toBe(true);
    expect(service.currentUser()?.emailVerified).toBe(false);
  });

  it('login() sets the session from the response', async () => {
    const promise = service.login('alice@example.com', 'Password123!');
    const req = httpMock.expectOne(`${base}/auth/login`);
    expect(req.request.body).toEqual({ identifier: 'alice@example.com', password: 'Password123!' });
    req.flush({ accessToken: 'tok2', user });

    await promise;
    expect(service.getAccessToken()).toBe('tok2');
  });

  it('requestEmailVerification() posts to the resend endpoint', async () => {
    const promise = service.requestEmailVerification();
    const req = httpMock.expectOne(`${base}/auth/verify-email/request`);
    expect(req.request.method).toBe('POST');
    req.flush(null);
    await promise;
  });

  it('confirmEmail() posts uid/token and patches the current user when it matches the active session', async () => {
    // Establish a session for user '1' first.
    const loginPromise = service.login('alice@example.com', 'Password123!');
    httpMock.expectOne(`${base}/auth/login`).flush({ accessToken: 'tok3', user });
    await loginPromise;

    const promise = service.confirmEmail('1', 'sometoken');
    const req = httpMock.expectOne(`${base}/auth/verify-email/confirm`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ userId: '1', token: 'sometoken' });
    req.flush(null);

    await promise;
    expect(service.currentUser()?.emailVerified).toBe(true);
  });

  it('confirmEmail() does not touch the current user when the uid belongs to someone else', async () => {
    const loginPromise = service.login('alice@example.com', 'Password123!');
    httpMock.expectOne(`${base}/auth/login`).flush({ accessToken: 'tok4', user });
    await loginPromise;

    const promise = service.confirmEmail('999', 'sometoken');
    httpMock.expectOne(`${base}/auth/verify-email/confirm`).flush(null);
    await promise;

    expect(service.currentUser()?.emailVerified).toBe(false);
  });

  it('login() returns a challenge (and sets no session) when 2FA is required', async () => {
    const promise = service.login('alice@example.com', 'Password123!');
    httpMock.expectOne(`${base}/auth/login`).flush({
      accessToken: null,
      user: null,
      twoFactorRequired: true,
      challengeToken: 'chal-abc',
    });

    const result = await promise;
    expect(result).toEqual({ twoFactorRequired: true, challengeToken: 'chal-abc' });
    expect(service.isAuthenticated()).toBe(false);
  });

  it('login() returns twoFactorRequired: false and sets the session on a normal login', async () => {
    const promise = service.login('alice@example.com', 'Password123!');
    httpMock.expectOne(`${base}/auth/login`).flush({
      accessToken: 'tok5',
      user,
      twoFactorRequired: false,
      challengeToken: null,
    });

    const result = await promise;
    expect(result).toEqual({ twoFactorRequired: false });
    expect(service.getAccessToken()).toBe('tok5');
  });

  it('verify2fa() posts the challenge token/code/rememberDevice and sets the session', async () => {
    const promise = service.verify2fa('chal-abc', '123456', true);
    const req = httpMock.expectOne(`${base}/auth/2fa/verify`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      challengeToken: 'chal-abc',
      code: '123456',
      rememberDevice: true,
    });
    req.flush({ accessToken: 'tok6', user });

    await promise;
    expect(service.getAccessToken()).toBe('tok6');
  });

  it('resend2fa() posts the challenge token', async () => {
    const promise = service.resend2fa('chal-abc');
    const req = httpMock.expectOne(`${base}/auth/2fa/resend`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ challengeToken: 'chal-abc' });
    req.flush(null);
    await promise;
  });

  it('enable2faRequest() posts the password', async () => {
    const promise = service.enable2faRequest('Password123!');
    const req = httpMock.expectOne(`${base}/auth/2fa/enable/request`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ password: 'Password123!' });
    req.flush(null);
    await promise;
  });

  it('enable2faConfirm() posts the code and flips twoFactorEnabled on', async () => {
    const loginPromise = service.login('alice@example.com', 'Password123!');
    httpMock.expectOne(`${base}/auth/login`).flush({ accessToken: 'tok7', user });
    await loginPromise;

    const promise = service.enable2faConfirm('123456');
    const req = httpMock.expectOne(`${base}/auth/2fa/enable/confirm`);
    expect(req.request.body).toEqual({ code: '123456' });
    req.flush(null);

    await promise;
    expect(service.currentUser()?.twoFactorEnabled).toBe(true);
  });

  it('disable2fa() posts the password and flips twoFactorEnabled off', async () => {
    const loginPromise = service.login('alice@example.com', 'Password123!');
    httpMock.expectOne(`${base}/auth/login`).flush({
      accessToken: 'tok8',
      user: { ...user, twoFactorEnabled: true },
    });
    await loginPromise;

    const promise = service.disable2fa('Password123!');
    const req = httpMock.expectOne(`${base}/auth/2fa/disable`);
    expect(req.request.body).toEqual({ password: 'Password123!' });
    req.flush(null);

    await promise;
    expect(service.currentUser()?.twoFactorEnabled).toBe(false);
  });

  it('clearTrustedDevices() sends a DELETE', async () => {
    const promise = service.clearTrustedDevices();
    const req = httpMock.expectOne(`${base}/auth/2fa/trusted-devices`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    await promise;
  });

  it('forgotPassword() posts the email', async () => {
    const promise = service.forgotPassword('alice@example.com');
    const req = httpMock.expectOne(`${base}/auth/forgot-password`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'alice@example.com' });
    req.flush(null);
    await promise;
  });

  it('loginWithGoogle() posts the idToken and sets the session', async () => {
    const promise = service.loginWithGoogle('fake-id-token');
    const req = httpMock.expectOne(`${base}/auth/google`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ idToken: 'fake-id-token' });
    req.flush({ accessToken: 'tok9', user });

    await promise;
    expect(service.getAccessToken()).toBe('tok9');
  });

  it('resetPassword() posts uid/token/newPassword', async () => {
    const promise = service.resetPassword('1', 'sometoken', 'NewPassword456!');
    const req = httpMock.expectOne(`${base}/auth/reset-password`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      userId: '1',
      token: 'sometoken',
      newPassword: 'NewPassword456!',
    });
    req.flush(null);
    await promise;
  });

  // --- Credential changes (Stage E) ---

  it('changePassword() posts current/new passwords and sets the fresh session', async () => {
    const promise = service.changePassword('OldPassword123!', 'NewPassword456!');
    const req = httpMock.expectOne(`${base}/auth/change-password`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      currentPassword: 'OldPassword123!',
      newPassword: 'NewPassword456!',
      code: null,
    });
    req.flush({ requiresCode: false, accessToken: 'tok10', user });

    const result = await promise;
    expect(result).toEqual({ requiresCode: false });
    expect(service.getAccessToken()).toBe('tok10');
  });

  it('changePassword() returns requiresCode:true and does not set a session, for a 2FA-enabled account', async () => {
    const promise = service.changePassword('OldPassword123!', 'NewPassword456!');
    const req = httpMock.expectOne(`${base}/auth/change-password`);
    req.flush({ requiresCode: true, accessToken: null, user: null });

    const result = await promise;
    expect(result).toEqual({ requiresCode: true });
    expect(service.isAuthenticated()).toBe(false);
  });

  it('changePassword() forwards the step-up code on the follow-up call', async () => {
    const promise = service.changePassword('OldPassword123!', 'NewPassword456!', '123456');
    const req = httpMock.expectOne(`${base}/auth/change-password`);
    expect(req.request.body).toEqual({
      currentPassword: 'OldPassword123!',
      newPassword: 'NewPassword456!',
      code: '123456',
    });
    req.flush({ requiresCode: false, accessToken: 'tok10b', user });

    await promise;
    expect(service.getAccessToken()).toBe('tok10b');
  });

  it('setPassword() posts the new password and patches hasPassword', async () => {
    const loginPromise = service.login('alice@example.com', 'Password123!');
    httpMock.expectOne(`${base}/auth/login`).flush({
      accessToken: 'tok11',
      user: { ...user, hasPassword: false },
    });
    await loginPromise;

    const promise = service.setPassword('NewPassword456!');
    const req = httpMock.expectOne(`${base}/auth/set-password`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ newPassword: 'NewPassword456!' });
    req.flush(null);

    await promise;
    expect(service.currentUser()?.hasPassword).toBe(true);
  });

  it('requestEmailChange() posts the password and new email, and returns requiresCode', async () => {
    const promise = service.requestEmailChange('Password123!', 'new@example.com');
    const req = httpMock.expectOne(`${base}/auth/change-email/request`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      password: 'Password123!',
      newEmail: 'new@example.com',
      code: null,
    });
    req.flush({ requiresCode: false });

    const result = await promise;
    expect(result).toBe(false);
  });

  it('requestEmailChange() returns true when the account is 2FA-enabled and no code was supplied', async () => {
    const promise = service.requestEmailChange('Password123!', 'new@example.com');
    const req = httpMock.expectOne(`${base}/auth/change-email/request`);
    req.flush({ requiresCode: true });

    const result = await promise;
    expect(result).toBe(true);
  });

  it('requestEmailChange() forwards the step-up code on the follow-up call', async () => {
    const promise = service.requestEmailChange('Password123!', 'new@example.com', '123456');
    const req = httpMock.expectOne(`${base}/auth/change-email/request`);
    expect(req.request.body).toEqual({
      password: 'Password123!',
      newEmail: 'new@example.com',
      code: '123456',
    });
    req.flush({ requiresCode: false });
    await promise;
  });

  it('confirmEmailChange() posts uid/email/token and patches the email when it matches the active session', async () => {
    const loginPromise = service.login('alice@example.com', 'Password123!');
    httpMock.expectOne(`${base}/auth/login`).flush({ accessToken: 'tok12', user });
    await loginPromise;

    const promise = service.confirmEmailChange('1', 'new@example.com', 'sometoken');
    const req = httpMock.expectOne(`${base}/auth/change-email/confirm`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ userId: '1', email: 'new@example.com', token: 'sometoken' });
    req.flush(null);

    await promise;
    expect(service.currentUser()?.email).toBe('new@example.com');
  });

  it('confirmEmailChange() does not touch the current user when the uid belongs to someone else', async () => {
    const loginPromise = service.login('alice@example.com', 'Password123!');
    httpMock.expectOne(`${base}/auth/login`).flush({ accessToken: 'tok13', user });
    await loginPromise;

    const promise = service.confirmEmailChange('999', 'new@example.com', 'sometoken');
    httpMock.expectOne(`${base}/auth/change-email/confirm`).flush(null);
    await promise;

    expect(service.currentUser()?.email).toBe('alice@example.com');
  });

  it('changeUsername() posts the password and new username and patches it locally', async () => {
    const loginPromise = service.login('alice@example.com', 'Password123!');
    httpMock.expectOne(`${base}/auth/login`).flush({ accessToken: 'tok14', user });
    await loginPromise;

    const promise = service.changeUsername('Password123!', 'newname');
    const req = httpMock.expectOne(`${base}/auth/change-username`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ password: 'Password123!', newUsername: 'newname' });
    req.flush(null);

    await promise;
    expect(service.currentUser()?.username).toBe('newname');
  });
});
