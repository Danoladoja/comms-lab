export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="text-center max-w-md px-4">
        <h1 className="text-9xl font-display font-bold text-primary mb-6">404</h1>
        <h2 className="text-2xl font-bold text-foreground mb-4">
          Page not found
        </h2>
        <p className="text-muted-foreground mb-8">
          We couldn't find the page you're looking for. It might have been moved or deleted.
        </p>
        <a href="/" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-10 px-8 py-2">
          Return to Home
        </a>
      </div>
    </div>
  );
}
