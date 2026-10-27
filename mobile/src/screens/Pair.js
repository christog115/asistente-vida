import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { normalizeAddress, pair, parsePairingQr } from '../api';
import { useTheme } from '../theme';
import { Button, Card, Muted } from '../ui';

const DEVICE_NAME = Platform.OS === 'ios' ? 'iPhone' : 'Android';

export default function Pair({ onPaired }) {
  const t = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scanned = useRef(false);

  async function connect(urls, pairingCode) {
    setBusy(true);
    setError('');
    try {
      onPaired(await pair(urls, pairingCode, DEVICE_NAME));
    } catch (err) {
      setError(err.message);
      setScanning(false);
    } finally {
      setBusy(false);
      scanned.current = false;
    }
  }

  async function startScan() {
    const granted = permission && permission.granted ? permission : await requestPermission();
    if (!granted.granted) return setError('Necesito permiso de la cámara para escanear. También puedes escribir los datos abajo.');
    setError('');
    scanned.current = false;
    setScanning(true);
  }

  function onScan({ data }) {
    if (scanned.current) return;
    const parsed = parsePairingQr(data);
    if (!parsed) return; // otro QR: se sigue buscando
    scanned.current = true;
    connect(parsed.urls, parsed.code);
  }

  function manual() {
    const url = normalizeAddress(address);
    if (!url) return setError('Escribe la dirección como aparece en la PC, por ejemplo 192.168.1.5');
    if (!/^\d{6}$/.test(code.trim())) return setError('El código tiene 6 números.');
    connect([url], code.trim());
  }

  if (scanning) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
        <SafeAreaView edges={['bottom']} style={s.scanBar}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', textAlign: 'center' }}>Apunta al código QR de tu PC</Text>}
          <Button title="Cancelar" kind="ghost" onPress={() => setScanning(false)} style={{ marginTop: 12, borderColor: '#fff' }} />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: t.text, fontSize: 26, fontWeight: '700', marginTop: 8 }}>Asistente de Vida</Text>
          <Muted style={{ marginBottom: 16 }}>Conecta esta app con tu PC.</Muted>

          <Card title="En tu PC">
            <Muted>
              Abre el Asistente → Conexiones → App del celular → Activar → Emparejar celular. Si estás fuera de casa, instala Tailscale en la PC y en este
              celular con la misma cuenta.
            </Muted>
          </Card>

          <Card title="Opción 1: escanear">
            <Button title="Escanear código QR" onPress={startScan} disabled={busy} />
          </Card>

          <Card title="Opción 2: escribir los datos">
            <TextInput
              style={[s.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]}
              placeholder="Dirección de la PC (ej. 192.168.1.5)"
              placeholderTextColor={t.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={address}
              onChangeText={setAddress}
            />
            <TextInput
              style={[s.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]}
              placeholder="Código de 6 números"
              placeholderTextColor={t.muted}
              keyboardType="number-pad"
              maxLength={6}
              value={code}
              onChangeText={setCode}
            />
            <Button title={busy ? 'Conectando…' : 'Conectar'} onPress={manual} disabled={busy} />
          </Card>

          {error ? <Text style={{ color: t.overdue, marginTop: 4 }}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, marginBottom: 10 },
  scanBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: 'rgba(0,0,0,0.6)' }
});
