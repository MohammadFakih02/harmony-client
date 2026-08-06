import { TestBed } from '@angular/core/testing';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ToastService] });
    service = TestBed.inject(ToastService);
  });

  it('a single mention shows a "You were mentioned" toast with the channel name', () => {
    service.pushMention('#general', ['/app/guilds', '1', 'channels', '2']);
    const toasts = service.toasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toBe('You were mentioned');
    expect(toasts[0].body).toBe('in #general');
  });

  it('a 1:1 DM mention reads "by {name}" instead of "in {name}"', () => {
    service.pushMention('alice', ['/app/dm', '7'], true);
    const toasts = service.toasts();
    expect(toasts[0].title).toBe('You were mentioned');
    expect(toasts[0].body).toBe('by alice');
  });

  it('aggregates repeated mentions into one count toast', () => {
    service.pushMention('#general', ['a']);
    service.pushMention('#random', ['b']);
    service.pushMention('#random', ['c']);

    const toasts = service.toasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toBe('You were mentioned 3 times');
    expect(toasts[0].body).toBeNull(); // count form drops the channel name
    expect(toasts[0].route).toEqual(['c']); // navigates to the most recent mention
  });

  it('starts a fresh aggregation after the previous toast is dismissed', () => {
    service.pushMention('#general', ['a']);
    service.pushMention('#general', ['a']);
    expect(service.toasts()[0].title).toBe('You were mentioned 2 times');

    service.dismiss(service.toasts()[0].id);
    service.pushMention('#general', ['a']);

    expect(service.toasts()).toHaveLength(1);
    expect(service.toasts()[0].title).toBe('You were mentioned'); // count reset to 1
  });

  it('dismiss removes a toast', () => {
    service.pushMention('#general', ['a']);
    const id = service.toasts()[0].id;
    service.dismiss(id);
    expect(service.toasts()).toHaveLength(0);
  });
});
