import { describe, expect, it } from 'vitest';
import {
  contentTypeFromName,
  effectiveContentType,
  fileIcon,
  fileKind,
  formatBytes,
  isAllowedType,
} from './file-kind';

describe('fileKind', () => {
  it('classifies images', () => {
    expect(fileKind('image/png')).toBe('image');
    expect(fileKind('image/webp')).toBe('image');
  });
  it('classifies video and audio', () => {
    expect(fileKind('video/mp4')).toBe('video');
    expect(fileKind('audio/mpeg')).toBe('audio');
  });
  it('falls back to file for docs/archives/unknown/empty', () => {
    expect(fileKind('application/pdf')).toBe('file');
    expect(fileKind('application/zip')).toBe('file');
    expect(fileKind(undefined)).toBe('file');
    expect(fileKind('')).toBe('file');
  });
  it('is case-insensitive', () => {
    expect(fileKind('IMAGE/PNG')).toBe('image');
  });
});

describe('fileIcon', () => {
  it('maps known doc types', () => {
    expect(fileIcon('application/pdf')).toBe('fa-file-pdf');
    expect(fileIcon('application/zip')).toBe('fa-file-zipper');
    expect(fileIcon('text/csv')).toBe('fa-file-csv');
    expect(fileIcon('text/plain')).toBe('fa-file-lines');
  });
  it('falls back to a generic file icon', () => {
    expect(fileIcon('application/octet-stream')).toBe('fa-file');
    expect(fileIcon(undefined)).toBe('fa-file');
  });
});

describe('isAllowedType', () => {
  it('accepts allowed media/doc types', () => {
    expect(isAllowedType('image/png')).toBe(true);
    expect(isAllowedType('video/mp4')).toBe(true);
    expect(isAllowedType('application/pdf')).toBe(true);
    expect(isAllowedType('APPLICATION/ZIP')).toBe(true);
  });
  it('rejects disallowed types', () => {
    expect(isAllowedType('image/svg+xml')).toBe(false);
    expect(isAllowedType('application/x-msdownload')).toBe(false);
    expect(isAllowedType('')).toBe(false);
  });
});

describe('contentTypeFromName', () => {
  it('maps signature-less text extensions', () => {
    expect(contentTypeFromName('notes.md')).toBe('text/markdown');
    expect(contentTypeFromName('README.MARKDOWN')).toBe('text/markdown');
    expect(contentTypeFromName('server.log')).toBe('text/plain');
    expect(contentTypeFromName('data.csv')).toBe('text/csv');
  });
  it('returns null for unknown or extensionless names', () => {
    expect(contentTypeFromName('archive.zip')).toBeNull();
    expect(contentTypeFromName('noextension')).toBeNull();
  });
});

describe('effectiveContentType', () => {
  it('uses the File type when present', () => {
    expect(effectiveContentType(new File([''], 'a.png', { type: 'image/png' }))).toBe('image/png');
  });
  it('falls back to the extension map when the browser gives none', () => {
    expect(effectiveContentType(new File([''], 'notes.md'))).toBe('text/markdown');
  });
  it('is empty when neither yields a type', () => {
    expect(effectiveContentType(new File([''], 'mystery.bin'))).toBe('');
  });
});

describe('formatBytes', () => {
  it('formats across units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB');
  });
  it('handles negatives defensively', () => {
    expect(formatBytes(-5)).toBe('0 B');
  });
});
