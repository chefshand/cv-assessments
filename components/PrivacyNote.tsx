export function PrivacyNote({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="muted text-xs">
        🔒 Don&apos;t enter names, MRNs, DOBs or other identifiers. Nothing is stored; free text is sent to Claude only when you tap Extract or Polish.
      </p>
    );
  }
  return (
    <div className="card p-4 text-sm">
      <p className="font-medium">🔒 Privacy</p>
      <ul className="muted mt-1 list-disc space-y-1 pl-5">
        <li>Do not enter names, MRNs, dates of birth, addresses or other identifiers. Use age, sex and clinical data only.</li>
        <li>Calculations and guideline logic run on your phone. Nothing is saved on the server or in your browser; reloading clears the form.</li>
        <li>Free text is sent to the Anthropic API only when you tap <em>Extract</em>, and inputs only when you tap <em>Polish</em>. The server does not log request content.</li>
      </ul>
    </div>
  );
}
