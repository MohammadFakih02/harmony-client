import { TestBed } from '@angular/core/testing';
import { GoogleSignInButton } from './google-sign-in-button';

describe('GoogleSignInButton', () => {
  let initialize: ReturnType<typeof vi.fn>;
  let renderButton: ReturnType<typeof vi.fn>;
  let capturedCallback: ((response: { credential: string }) => void) | undefined;

  beforeEach(() => {
    initialize = vi.fn((config: { callback: (response: { credential: string }) => void }) => {
      capturedCallback = config.callback;
    });
    renderButton = vi.fn();
    window.google = { accounts: { id: { initialize, renderButton } } } as unknown as Window['google'];

    TestBed.configureTestingModule({
      imports: [GoogleSignInButton],
    });
  });

  afterEach(() => {
    delete window.google;
  });

  it('initializes and renders the button with the configured client ID on view init', () => {
    const fixture = TestBed.createComponent(GoogleSignInButton);
    fixture.detectChanges();

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: expect.any(String) }),
    );
    expect(renderButton).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ text: 'continue_with', locale: 'en', width: expect.any(Number) }),
    );
  });

  it('emits the credential when the GIS callback fires', () => {
    const fixture = TestBed.createComponent(GoogleSignInButton);
    fixture.detectChanges();

    const emitted: string[] = [];
    fixture.componentInstance.credential.subscribe((token) => emitted.push(token));

    capturedCallback!({ credential: 'fake-id-token' });

    expect(emitted).toEqual(['fake-id-token']);
  });

  it('does nothing when the GIS script has not loaded', () => {
    delete window.google;
    const fixture = TestBed.createComponent(GoogleSignInButton);

    expect(() => fixture.detectChanges()).not.toThrow();
  });
});
