import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from './theme';

export function Card({ title, children }) {
  const t = useTheme();
  return (
    <View style={[s.card, { backgroundColor: t.card, borderColor: t.border }]}>
      {title ? <Text style={[s.cardTitle, { color: t.text }]}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Muted({ children, style }) {
  const t = useTheme();
  return <Text style={[{ color: t.muted, fontSize: 14 }, style]}>{children}</Text>;
}

export function Button({ title, onPress, kind = 'primary', disabled, style }) {
  const t = useTheme();
  const primary = kind === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        { backgroundColor: primary ? t.accent : 'transparent', borderColor: primary ? t.accent : t.border, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style
      ]}
    >
      <Text style={{ color: primary ? t.onAccent : t.text, fontSize: 16, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

// Fila de lista: título, detalle y, si tiene enlace, se abre al tocar.
export function Row({ title, meta, url, state }) {
  const t = useTheme();
  const metaColor = state === 'overdue' ? t.overdue : state === 'soon' ? t.soon : t.muted;
  const open = () => {
    if (/^https?:\/\//.test(url || '')) Linking.openURL(url);
  };
  return (
    <Pressable onPress={open} disabled={!url} style={[s.row, { borderTopColor: t.border }]}>
      <Text style={{ color: t.text, fontSize: 16, fontWeight: '500' }}>{title}</Text>
      {meta ? <Text style={{ color: metaColor, fontSize: 13, marginTop: 2 }}>{meta}</Text> : null}
    </Pressable>
  );
}

// Lista con los tres estados de siempre: error, sin conectar y vacío.
export function ListCard({ title, items, empty, render }) {
  const t = useTheme();
  let body;
  if (items && items.error) body = <Muted>No se pudo cargar: {items.error}</Muted>;
  else if (!items) body = <Muted>Conéctala en el Asistente de tu PC.</Muted>;
  else if (!items.length) body = <Muted>{empty}</Muted>;
  else body = items.map((it, i) => <View key={i}>{render(it)}</View>);
  return (
    <Card title={title}>
      <View style={{ marginTop: 2, borderTopColor: t.border }}>{body}</View>
    </Card>
  );
}

export const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  button: { borderWidth: 1, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  row: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth }
});
