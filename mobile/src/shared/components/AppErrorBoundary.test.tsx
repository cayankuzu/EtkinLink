import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import { AppErrorBoundary } from './AppErrorBoundary';

function BrokenView(): never {
  throw new Error('render failed');
}

describe('AppErrorBoundary', () => {
  it('renders a safe recovery screen after a child render error', async () => {
    const onError = jest.fn();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AppErrorBoundary onError={onError}>
          <BrokenView />
        </AppErrorBoundary>,
      );
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(
      renderer!.root.findByProps({ children: 'Bir sorun oluştu' }),
    ).toBeTruthy();
    consoleError.mockRestore();
  });
});
