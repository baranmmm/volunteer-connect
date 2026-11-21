import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn(), deleted: vi.fn(), close: vi.fn(), invalidate: vi.fn() }));
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock('@/lib/delete-user.functions', () => ({ deleteUser: mocks.run }));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }));

import { DeleteUserDialog } from '@/components/app/DeleteUserDialog';
import { setLanguage } from '@/lib/i18n';

beforeEach(() => {
  vi.clearAllMocks();
  setLanguage('en');
  mocks.run.mockResolvedValue(undefined);
  mocks.invalidate.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  setLanguage('en');
});

describe('user deletion confirmation', () => {
  it('keeps ordinary admin deletion on simple confirmation without a name field', async () => {
    render(<DeleteUserDialog target={{ id: 'user-1', fullName: 'Mehmet Baran' }} onClose={mocks.close} onDeleted={mocks.deleted} />);

    expect(screen.getByTestId('delete-user-dialog')).toBeVisible();
    expect(screen.queryByTestId('delete-user-name-input')).toBeNull();
    const confirm = screen.getByTestId('confirm-dialog-confirm-button');
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.run).toHaveBeenCalledWith({ data: { userId: 'user-1', requestId: null } }));
    expect(mocks.deleted).toHaveBeenCalledOnce();
  });

  it('enables a self-requested erasure only after the exact full name is entered', async () => {
    render(<DeleteUserDialog target={{ id: 'user-1', fullName: 'Mehmet Baran', requestId: 'request-1' }} onClose={mocks.close} onDeleted={mocks.deleted} />);

    const input = screen.getByTestId('delete-user-name-input');
    const confirm = screen.getByTestId('confirm-dialog-confirm-button');
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: 'mehmet baran' } });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(mocks.run).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'Mehmet Baran' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.run).toHaveBeenCalledWith({ data: { userId: 'user-1', requestId: 'request-1' } }));
    expect(mocks.deleted).toHaveBeenCalledOnce();
  });
});
