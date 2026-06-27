import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Toast, ToastService } from '../../../core/services/toast.service';

/** Fixed bottom-right stack of transient toasts. Clicking one follows its route. */
@Component({
  selector: 'app-toast-container',
  standalone: true,
  templateUrl: './toast-container.html',
})
export class ToastContainer {
  protected readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected open(t: Toast): void {
    if (t.route) this.router.navigate(t.route as unknown[]);
    this.toast.dismiss(t.id);
  }
}
