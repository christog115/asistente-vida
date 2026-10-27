import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { getData, refresh } from '../api';
import { dueState, fmtDate, greeting } from '../format';
import { useTheme } from '../theme';
import { Card, ListCard, Muted, Row } from '../ui';

export default function Dashboard({ conn, onUnpaired }) {
  const t = useTheme();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (fn) => {
    try {
      setData(await fn(conn));
      setError('');
    } catch (err) {
      if (err.status === 401) return onUnpaired();
      setError(err.message);
    }
  }, [conn, onUnpaired]);

  useEffect(() => {
    load(getData);
  }, [load]);

  const pull = async () => {
    setRefreshing(true);
    await load(refresh);
    setRefreshing(false);
  };

  const school = (data && data.school) || [];
  const soon = school.filter((x) => dueState(x.due)).length;
  const b = data && data.briefing;
  const briefing = b && b.date === new Date().toDateString() ? b.text : null;
  const schoolErr = data && data.errors ? [data.errors.classroom, data.errors.moodle].filter(Boolean).join(' · ') : '';

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={t.accent} />}
    >
      <Text style={{ color: t.text, fontSize: 24, fontWeight: '700' }}>{greeting()}</Text>
      <Muted style={{ marginBottom: 12 }}>
        {data ? `${school.length} tareas de la escuela · ${soon} vencen pronto · actualizado ${fmtDate(data.updatedAt)}` : 'Cargando…'}
      </Muted>

      {error ? (
        <Card>
          <Text style={{ color: t.overdue }}>{error}</Text>
          <Muted style={{ marginTop: 6 }}>Desliza hacia abajo para reintentar.</Muted>
        </Card>
      ) : null}

      {data ? (
        <View>
          {briefing ? (
            <Card title="Resumen del asistente">
              <Text style={{ color: t.text, fontSize: 15, lineHeight: 21 }}>{briefing}</Text>
            </Card>
          ) : null}

          <ListCard
            title="Tareas de la escuela"
            items={schoolErr && !school.length ? { error: schoolErr } : school}
            empty="Sin tareas pendientes 🎉"
            render={(x) => (
              <Row
                title={x.title}
                meta={`${x.source} · ${x.course || ''} · ${x.due ? 'entrega ' + fmtDate(x.due) : x.dueText || 'sin fecha'}`}
                url={x.url}
                state={dueState(x.due)}
              />
            )}
          />
          <ListCard
            title="Hoy y mañana"
            items={data.events}
            empty="Nada en el calendario."
            render={(e) => <Row title={e.title} meta={fmtDate(e.start, e.allDay)} url={e.url} />}
          />
          <ListCard
            title="Pendientes"
            items={data.tasks}
            empty="Sin pendientes."
            render={(x) => <Row title={x.title} meta={x.list + (x.due ? ' · ' + fmtDate(x.due, true) : '')} state={dueState(x.due)} />}
          />
          <ListCard
            title="Hoja de pendientes"
            items={data.sheet}
            empty="Todo hecho en tu hoja."
            render={(x) => <Row title={x.title} meta={x.due ? 'para ' + x.due : 'sin fecha'} url={x.url} />}
          />
          <ListCard
            title="Correos sin leer"
            items={data.emails}
            empty="Bandeja al día."
            render={(m) => <Row title={m.subject} meta={m.from} url={m.url} />}
          />
          <ListCard
            title="Archivos recientes de Drive"
            items={data.files}
            empty="Sin archivos recientes."
            render={(f) => <Row title={f.name} url={f.url} />}
          />
          {data.spotify && !data.spotify.error ? (
            <ListCard
              title={data.spotify.nowPlaying ? `Suena: ${data.spotify.nowPlaying.title}` : 'Spotify'}
              items={data.spotify.recent}
              empty="Sin canciones recientes."
              render={(t) => <Row title={t.title} meta={t.artist} url={t.url} />}
            />
          ) : null}
          {data.designs ? (
            <ListCard
              title="Diseños recientes de Canva"
              items={data.designs}
              empty="Aún no tienes diseños."
              render={(d) => <Row title={d.title} url={d.url} />}
            />
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
