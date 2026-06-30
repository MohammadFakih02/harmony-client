import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForwardService, buildForwardContent } from './forward.service';
import { FileService } from './file.service';
import { MessageService } from './message.service';
import { FileStore } from '../stores/file.store';

describe('buildForwardContent', () => {
  it('joins a note and the original with a blank line', () => {
    expect(buildForwardContent('look', 'hello')).toBe('look\n\nhello');
  });
  it('uses the note alone when there is no original (image-only forward)', () => {
    expect(buildForwardContent('look', '')).toBe('look');
  });
  it('uses the original alone when there is no note', () => {
    expect(buildForwardContent(undefined, 'hello')).toBe('hello');
  });
  it('is empty when both are empty', () => {
    expect(buildForwardContent('  ', '')).toBe('');
  });
});

describe('ForwardService', () => {
  let fileService: { presign: ReturnType<typeof vi.fn>; upload: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn> };
  let fileStore: { resolve: ReturnType<typeof vi.fn> };
  let messageService: { sendMessage: ReturnType<typeof vi.fn> };
  let service: ForwardService;

  const target = { guildId: 'g2', channelId: 'c2' };

  beforeEach(() => {
    fileService = {
      presign: vi.fn().mockResolvedValue({ fileId: 'new-pending', uploadUrl: 'http://store/put' }),
      upload: vi.fn().mockResolvedValue(undefined),
      confirm: vi.fn().mockResolvedValue({ id: 'new-confirmed' }),
    };
    fileStore = { resolve: vi.fn() };
    messageService = { sendMessage: vi.fn().mockResolvedValue({ messageId: 'm-new' }) };

    (globalThis as unknown as { fetch: unknown }).fetch = vi
      .fn()
      .mockResolvedValue({ blob: () => Promise.resolve(new Blob(['x'], { type: 'image/png' })) });

    TestBed.configureTestingModule({
      providers: [
        ForwardService,
        { provide: FileService, useValue: fileService },
        { provide: FileStore, useValue: fileStore },
        { provide: MessageService, useValue: messageService },
      ],
    });
    service = TestBed.inject(ForwardService);
  });

  it('forwards a text-only message without touching the file APIs', async () => {
    await service.forward(
      { guildId: 'g1', channelId: 'c1', content: 'hi', attachmentIds: [] },
      target,
    );

    expect(fileService.presign).not.toHaveBeenCalled();
    expect(messageService.sendMessage).toHaveBeenCalledWith('g2', 'c2', 'hi', {
      attachmentIds: undefined,
    });
  });

  it('re-uploads an attachment to the target and sends the fresh id', async () => {
    fileStore.resolve.mockResolvedValue({
      url: 'http://store/get',
      filename: 'pic.png',
      contentType: 'image/png',
    });

    await service.forward(
      { guildId: 'g1', channelId: 'c1', content: '', attachmentIds: ['old-1'] },
      target,
      'fwd',
    );

    // Resolved from the source channel, re-uploaded to the target channel.
    expect(fileStore.resolve).toHaveBeenCalledWith('g1', 'c1', 'old-1');
    expect(fileService.presign).toHaveBeenCalledWith('g2', 'c2', {
      filename: 'pic.png',
      contentType: 'image/png',
      sizeBytes: expect.any(Number),
    });
    expect(fileService.upload).toHaveBeenCalledWith('http://store/put', expect.any(File));
    expect(fileService.confirm).toHaveBeenCalledWith('g2', 'c2', 'new-pending');
    expect(messageService.sendMessage).toHaveBeenCalledWith('g2', 'c2', 'fwd', {
      attachmentIds: ['new-confirmed'],
    });
  });

  it('skips an unresolvable attachment rather than failing the forward', async () => {
    fileStore.resolve.mockResolvedValue(null);

    await service.forward(
      { guildId: 'g1', channelId: 'c1', content: 'hi', attachmentIds: ['gone'] },
      target,
    );

    expect(fileService.presign).not.toHaveBeenCalled();
    expect(messageService.sendMessage).toHaveBeenCalledWith('g2', 'c2', 'hi', {
      attachmentIds: undefined,
    });
  });
});
