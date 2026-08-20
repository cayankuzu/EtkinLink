import 'react-native-gesture-handler';
import 'react-native-get-random-values';

import { AppRegistry } from 'react-native';

import App from './App';
import { initializeTelemetry } from './src/shared/lib/telemetry';

initializeTelemetry();

AppRegistry.registerComponent('EtkinLink', () => App);
