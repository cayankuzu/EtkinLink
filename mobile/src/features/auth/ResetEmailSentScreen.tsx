import type { AuthStackParamList } from '@app/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton, AppText } from '@shared/components';

import { AuthLayout } from './AuthLayout';

type Props = NativeStackScreenProps<AuthStackParamList, 'ResetEmailSent'>;

export function ResetEmailSentScreen({ route, navigation }: Props) {
  return (
    <AuthLayout
      title="İsteğini aldık"
      description={`${route.params.email} kayıtlı bir hesaba aitse şifre yenileme bağlantısı gönderildi.`}
    >
      <AppText tone="secondary">
        Güvenliğin için bir e-posta adresinin sistemde kayıtlı olup olmadığını
        açıklamıyoruz. Bağlantı gelmezse adresini ve spam klasörünü kontrol et.
      </AppText>
      <AppButton
        label="Giriş ekranına dön"
        variant="secondary"
        onPress={() => navigation.replace('SignIn')}
      />
    </AuthLayout>
  );
}
