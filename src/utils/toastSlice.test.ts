import assert from 'node:assert/strict';
import { test } from 'node:test';
import toastReducer, { addToast } from '../features/toast/toastSlice';

test('toast reducer suppresses an identical notification while it is visible', () => {
  const first = toastReducer(
    undefined,
    addToast({ type: 'error', title: 'Checkout', message: 'Payment failed' })
  );
  const second = toastReducer(
    first,
    addToast({ type: 'error', title: 'Checkout', message: 'Payment failed' })
  );

  assert.equal(first.toasts.length, 1);
  assert.equal(second.toasts.length, 1);
  assert.equal(second.toasts[0].id, first.toasts[0].id);
});

test('toast reducer keeps the latest four distinct notifications', () => {
  let state = toastReducer(undefined, { type: 'init' });

  for (let index = 0; index < 5; index += 1) {
    state = toastReducer(
      state,
      addToast({ message: `Notification ${index}` })
    );
  }

  assert.deepEqual(
    state.toasts.map((toast) => toast.message),
    ['Notification 1', 'Notification 2', 'Notification 3', 'Notification 4']
  );
});
