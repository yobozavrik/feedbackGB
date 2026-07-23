/**
 * The authenticated Supply surface uses the same mobile-first shell as the
 * seller app.  Keeping this in a route layout means every nested screen
 * (Supply actions, requests, HR and notifications) has one consistent
 * handset-width container rather than expanding across a desktop viewport.
 */
export default function SupplyAuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-10 pt-5 sm:px-6">
      {children}
    </div>
  );
}
