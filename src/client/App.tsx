import { Landing } from "./pages/Landing";
import { RoomPage } from "./pages/RoomPage";
import { usePath } from "./router";
import { MotionProvider } from "./hooks/motion";

export function App() {
  const path = usePath();
  const m = path.match(/^\/r\/([A-Za-z0-9]{6})(\/report)?\/?$/);
  return (
    <MotionProvider>
      {m ? <RoomPage key={m[1].toUpperCase()} code={m[1].toUpperCase()} report={!!m[2]} /> : <Landing />}
    </MotionProvider>
  );
}
