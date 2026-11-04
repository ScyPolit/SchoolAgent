import { schoolDownload } from '../api';

jest.mock('~/hooks/AuthContext', () => ({ useAuthContext: jest.fn() }));

describe('permission-checked school exports', () => {
  const clickedNames: string[] = [];
  beforeEach(() => {
    clickedNames.length = 0;
    jest.useFakeTimers();
    URL.createObjectURL = jest.fn(() => 'blob:school-export');
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickedNames.push(this.download);
    });
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });
  function exportResponse(name: string) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => `attachment; filename="${name}"` },
      blob: async () => new Blob(['export']),
    });
  }
  it('honors a requested basename while preserving the actual ZIP extension of a long PNG export', async () => {
    exportResponse('server-parts.zip');
    await schoolDownload('/conversations/c_1/export?format=png', 'My conversation.png');
    expect(clickedNames).toEqual(['My conversation.zip']);
    expect(fetch).toHaveBeenCalledWith('/api/conversations/c_1/export?format=png', {
      credentials: 'same-origin',
    });
  });
  it('preserves the server filename for administrative exports', async () => {
    exportResponse('server-title.pdf');
    await schoolDownload('/admin/conversations/c_1/export?format=pdf');
    expect(clickedNames).toEqual(['server-title.pdf']);
  });
  it('does not produce a download when the server rejects permission', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: 'Login required' }) });
    await expect(schoolDownload('/conversations/c_1/export?format=pdf')).rejects.toThrow(
      'Login required',
    );
    expect(clickedNames).toHaveLength(0);
  });
});
