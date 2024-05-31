import { World } from "./world";
import { AdvancedDynamicTexture, TextBlock } from "@babylonjs/gui";

export class GUI {

    private indicator: TextBlock;
    private font_texture: AdvancedDynamicTexture;

    constructor(world: World) {
        this.font_texture = AdvancedDynamicTexture.CreateFullscreenUI("UI");
        this.indicator = new TextBlock("indicator")
        this.init_indicator();
    }

    public init_indicator = () => {
        this.indicator.left = "2%";
        this.indicator.top = "48%";
        this.indicator.width
        this.indicator.textHorizontalAlignment = 0;
        // this.font_texture.useSmallestIdeal = true;
        this.font_texture.addControl(this.indicator);
    }

    public update_indicator = (text: string) => {
        this.indicator.text = text;
        this.indicator.color = "white";
        this.indicator.fontSize = 24;
    }
}