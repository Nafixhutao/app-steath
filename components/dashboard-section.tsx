export function DashboardSection({ title, description }: { title: string; description: string }) {
  return (
    <div className="dashboard-content">
      <div className="dashboard-page-heading">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <section className="dashboard-section">
        <div className="dashboard-empty-state">
          <h2>No {title.toLowerCase()} yet</h2>
          <p>This Organization has no {title.toLowerCase()}.</p>
        </div>
      </section>
    </div>
  );
}
