import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Chat from './src/screens/Chat';
import Dashboard from './src/screens/Dashboard';
import Pair from './src/screens/Pair';
import Settings from './src/screens/Settings';
import { clearConnection, loadConnection, saveConnection } from './src/storage';
import { useTheme } from './src/theme';

const TABS = [
  { key: 'tablero', label: 'Tablero' },
  { key: 'asistente', label: 'Asistente' },
  { key: 'ajustes', label: 'Ajustes' }
];

function Main({ conn, onUnpaired }) {
  const t = useTheme();
  const [tab, setTab] = useState('tablero');
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <View style={{ flex: 1 }}>
        {tab === 'tablero' ? <Dashboard conn={conn} onUnpaired={onUnpaired} /> : null}
        {tab === 'asistente' ? <Chat conn={conn} onUnpaired={onUnpaired} /> : null}
        {tab === 'ajustes' ? <Settings conn={conn} onDisconnect={onUnpaired} /> : null}
      </View>
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: t.border, backgroundColor: t.card }}>
        {TABS.map((x) => (
          <Pressable key={x.key} accessibilityRole="tab" onPress={() => setTab(x.key)} style={{ flex: 1, paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ color: tab === x.key ? t.accent : t.muted, fontWeight: tab === x.key ? '700' : '500', fontSize: 15 }}>{x.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  const t = useTheme();
  const [conn, setConn] = useState(undefined); // undefined = cargando, null = sin emparejar

  useEffect(() => {
    loadConnection().then(setConn);
  }, []);

  const paired = useCallback(async (c) => {
    await saveConnection(c);
    setConn(c);
  }, []);

  const unpaired = useCallback(async () => {
    await clearConnection();
    setConn(null);
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {conn === undefined ? (
        <View style={{ flex: 1, justifyContent: 'center', backgroundColor: t.bg }}>
          <ActivityIndicator color={t.accent} />
        </View>
      ) : conn === null ? (
        <Pair onPaired={paired} />
      ) : (
        <Main conn={conn} onUnpaired={unpaired} />
      )}
    </SafeAreaProvider>
  );
}
