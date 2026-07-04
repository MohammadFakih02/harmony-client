import { publicFileUrl } from './public-file-url';
import { environment } from '../../../environments/environment';

describe('publicFileUrl', () => {
  it('maps a storage key to the public serve endpoint', () => {
    expect(publicFileUrl('avatars/123/456')).toBe(
      `${environment.apiUrl}/files/public/avatars/123/456`,
    );
    expect(publicFileUrl('banners/123/789')).toBe(
      `${environment.apiUrl}/files/public/banners/123/789`,
    );
  });

  it('passes absolute and object URLs through untouched', () => {
    expect(publicFileUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(publicFileUrl('blob:http://localhost/x')).toBe('blob:http://localhost/x');
    expect(publicFileUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('keeps null/empty as null', () => {
    expect(publicFileUrl(null)).toBeNull();
    expect(publicFileUrl(undefined)).toBeNull();
    expect(publicFileUrl('')).toBeNull();
  });
});
