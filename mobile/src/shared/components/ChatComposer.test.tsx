import { fireEvent, render } from '@testing-library/react-native';

import { ChatComposer } from './ChatComposer';

describe('ChatComposer', () => {
  it('metin, blur, emoji ve gönder aksiyonlarını iletir', async () => {
    const onChangeText = jest.fn();
    const onBlur = jest.fn();
    const onAddEmoji = jest.fn();
    const onSend = jest.fn();
    const screen = await render(
      <ChatComposer
        accessibilityLabel="Test mesajı yaz"
        value="Merhaba"
        onChangeText={onChangeText}
        onBlur={onBlur}
        onAddEmoji={onAddEmoji}
        onSend={onSend}
      />,
    );

    await fireEvent.changeText(
      screen.getByLabelText('Test mesajı yaz'),
      'Yeni',
    );
    await fireEvent(screen.getByLabelText('Test mesajı yaz'), 'blur');
    await fireEvent.press(screen.getByLabelText('Gülümseme ekle'));
    await fireEvent.press(screen.getByLabelText('Mesajı gönder'));

    expect(onChangeText).toHaveBeenCalledWith('Yeni');
    expect(onBlur).toHaveBeenCalled();
    expect(onAddEmoji).toHaveBeenCalled();
    expect(onSend).toHaveBeenCalled();
    await screen.unmount();
  });

  it('boş mesajda gönderimi kapatır ve emoji aksiyonunu göstermez', async () => {
    const screen = await render(
      <ChatComposer
        accessibilityLabel="Boş mesaj"
        value=" "
        onChangeText={jest.fn()}
        onBlur={jest.fn()}
        onSend={jest.fn()}
      />,
    );

    expect(screen.queryByLabelText('Gülümseme ekle')).toBeNull();
    expect(screen.getByLabelText('Mesajı gönder')).toBeDisabled();
    await screen.unmount();
  });
});
