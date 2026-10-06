import { DemoHome } from "./pages/DemoHome";
import { Learn } from "./pages/Learn";
import { RoomPage } from "./pages/RoomPage";
import { usePath } from "./router";
import { MotionProvider } from "./hooks/motion";

export function App() {
  const path = usePath();
  const m = path.match(/^\/r\/([A-Za-z0-9]{6})(\/report)?\/?$/);
  let page;
  if (m) page = <RoomPage key={m[1].toUpperCase()} code={m[1].toUpperCase()} report={!!m[2]} />;
  else if (/^\/learn\/?$/.test(path)) page = <Learn />;
  else page = <DemoHome />;
  return <MotionProvider>{page}</MotionProvider>;
}
