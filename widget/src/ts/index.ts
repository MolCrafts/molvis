import { MolvisWidget } from "./widget";
import { preventEventPropagation } from "./utils";
import type { ModelType } from "./types";
import { Logger } from "tslog";

const logger = new Logger({ name: "molvis-widget" });

export default () => {
  const widgets = new Map<number, MolvisWidget>();

  return {
    initialize({ model }: { model: ModelType }) {
      const session_id = model.get("session_id");
      let widget = widgets.get(session_id);
      if (widget === undefined) {
        widget = new MolvisWidget(model);
        widgets.set(session_id, widget);
        widget.start();
      }
      return () => {
        widgets.get(session_id)?.stop();
        logger.info(`<MolvisWidget ${session_id}> init cleanup`);
      };
    },

    render({ model, el }: { model: ModelType; el: HTMLElement }) {
      preventEventPropagation(el);

      const session_id = model.get("session_id");
      const widget = widgets.get(session_id);
      if (widget) {
        widget.attach(el);
        widget.resize();
      } else {
        throw new Error(`<MolvisWidget ${session_id}> ??? not found`);
      }

      return () => {
        logger.info(`<MolvisWidget ${session_id}> render cleanup`);
        widget.detach(el);
      };
    },
  };
};
