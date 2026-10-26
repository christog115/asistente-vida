import { useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { chat } from '../api';
import { useTheme } from '../theme';
import { Button, Muted } from '../ui';

export default function Chat({ conn, onUnpaired }) {
  const t = useTheme();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef(null);

  async function send() {
    const content = text.trim();
    if (!content || busy) return;
    const history = [...messages.filter((m) => !m.error), { role: 'user', content }];
    setMessages([...messages, { role: 'user', content }]);
    setText('');
    setBusy(true);
    try {
      const answer = await chat(conn, history.map(({ role, content: c }) => ({ role, content: c })));
      setMessages((m) => [...m, { role: 'assistant', content: answer || '(sin respuesta)' }]);
    } catch (err) {
      if (err.status === 401) return onUnpaired();
      setMessages((m) => [...m, { role: 'assistant', content: err.message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        ref={list}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
        onContentSizeChange={() => list.current && list.current.scrollToEnd({ animated: true })}
        ListEmptyComponent={<Muted>Pregúntame lo que quieras sobre tus tareas, tu calendario o tus correos. Por ejemplo: "¿Qué entrego esta semana?"</Muted>}
        renderItem={({ item }) => {
          const mine = item.role === 'user';
          return (
            <View
              style={[
                s.bubble,
                mine ? { alignSelf: 'flex-end', backgroundColor: t.accent } : { alignSelf: 'flex-start', backgroundColor: t.card, borderWidth: 1, borderColor: t.border }
              ]}
            >
              <Text style={{ color: mine ? t.onAccent : item.error ? t.overdue : t.text, fontSize: 16 }}>{item.content}</Text>
            </View>
          );
        }}
      />
      {busy ? <Muted style={{ paddingHorizontal: 16, paddingBottom: 6 }}>Pensando…</Muted> : null}
      <View style={[s.bar, { borderTopColor: t.border, backgroundColor: t.card }]}>
        <TextInput
          style={[s.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]}
          placeholder="Escribe tu pregunta…"
          placeholderTextColor={t.muted}
          value={text}
          onChangeText={setText}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Button title="Enviar" onPress={send} disabled={busy || !text.trim()} />
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  bubble: { maxWidth: '85%', padding: 12, borderRadius: 14 },
  bar: { flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 }
});
