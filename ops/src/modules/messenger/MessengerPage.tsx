import React from 'react';
import { Alert, Card, CardContent, Stack, Typography } from '@mui/material';

export default function MessengerPage() {
  return (
    <Stack spacing={1.4} className="ops-page-shell">
      <Card>
        <CardContent sx={{ p: { xs: 1.8, md: 2.2 } }}>
          <Typography variant="h5">Messenger</Typography>
          <Typography variant="body2" color="text.secondary">
            Der Chatbereich ist im Hintergrund aktiv und erscheint hier als Vollansicht.
          </Typography>
        </CardContent>
      </Card>
      <Alert severity="info">Direktchat, Gruppen, Reaktionen, Zitate, Anrufe und Datei-/Ticketlinks stehen vollständig zur Verfügung.</Alert>
    </Stack>
  );
}
