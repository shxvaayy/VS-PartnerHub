import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "./ui";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export default function InstallApp() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    const installed = () => setEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  if (!event) return null;
  return (
    <Button
      variant="secondary"
      className="install-app"
      onClick={async () => {
        try {
          await event.prompt();
          await event.userChoice;
        } catch {
          /* The browser can dismiss an expired installation prompt. */
        } finally {
          setEvent(null);
        }
      }}
    >
      <Download size={15} />
      Install PartnerHub
    </Button>
  );
}
