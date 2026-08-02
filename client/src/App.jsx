import "./App.css";

function App() {
  return (
    <main className="shell">
      <header className="shell__header">
        <p className="shell__eyebrow">QueueIt (QIT)</p>
        <h1>Virtual queue management</h1>
        <p className="shell__lede">
          Scaffold shell — auth, queues, and admin controls land in later tickets.
        </p>
      </header>
      <section className="shell__card" aria-label="Status">
        <p>
          Frontend is running. Backend health endpoint:{" "}
          <code>GET /api/health</code>
        </p>
      </section>
    </main>
  );
}

export default App;
