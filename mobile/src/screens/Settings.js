import { ScrollView } from 'react-native';
import { Button, Card, Muted } from '../ui';

export default function Settings({ conn, onDisconnect }) {
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Card title="Conexión con tu PC">
        <Muted>Conectado a {conn.base}</Muted>
        <Muted style={{ marginTop: 8, marginBottom: 12 }}>
          Para quitar este celular del todo, también ábrelo en el Asistente de tu PC (Conexiones → App del celular) y toca Quitar.
        </Muted>
        <Button title="Desconectar este celular" kind="ghost" onPress={onDisconnect} />
      </Card>
      <Card title="Acerca de">
        <Muted>Asistente de Vida · app del celular. Tus datos viajan directo entre tu PC y este celular, sin servidores en medio.</Muted>
      </Card>
    </ScrollView>
  );
}
