jest.mock('../lib/haptics', () => ({
  triggerHaptic: jest.fn(),
}));

import { triggerHaptic } from '@shared/lib/haptics';
import { act, fireEvent, render } from '@testing-library/react-native';

import { AppButton } from './AppButton';

const mockTriggerHaptic = jest.mocked(triggerHaptic);

describe('AppButton', () => {
  beforeEach(() => jest.clearAllMocks());

  it('erişilebilir button rolü, label ve disabled durumunu korur', async () => {
    const onPress = jest.fn();
    const view = await render(
      <AppButton label="Devam et" disabled onPress={onPress} />,
    );
    const button = view.getByRole('button', { name: 'Devam et' });

    expect(button).toBeDisabled();
    expect(button.props.accessibilityState).toEqual({
      disabled: true,
      busy: false,
    });
    expect(button.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ minHeight: expect.any(Number) }),
      ]),
    );
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(mockTriggerHaptic).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('async aksiyon sürerken busy/disabled olur ve çifte gönderimi engeller', async () => {
    let complete: (() => void) | null = null;
    const onPress = jest.fn(
      () =>
        new Promise<void>(resolve => {
          complete = resolve;
        }),
    );
    const view = await render(<AppButton label="Kaydet" onPress={onPress} />);
    const button = view.getByRole('button', { name: 'Kaydet' });

    await fireEvent.press(button);
    expect(button.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);

    await act(async () => {
      complete?.();
      await Promise.resolve();
    });
    expect(button.props.accessibilityState).toEqual({
      disabled: false,
      busy: false,
    });
    await view.unmount();
  });

  it('650ms dokunma korumasını uygular ve danger aksiyonunda warning haptic verir', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-19T12:00:00.000Z'));
    const onPress = jest.fn();
    const view = await render(
      <AppButton label="Sil" variant="danger" onPress={onPress} />,
    );
    const button = view.getByRole('button', { name: 'Sil' });

    await fireEvent.press(button);
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mockTriggerHaptic).toHaveBeenCalledWith('warning');
    jest.advanceTimersByTime(650);
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
    await view.unmount();
  });
});
