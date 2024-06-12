import { useState, useContext } from "react";
import {
    Hamburger,
    NavCategory,
    NavCategoryItem,
    NavDrawer,
    NavDrawerBody,
    NavDrawerFooter,
    NavDrawerHeader,
    NavDrawerHeaderNav,
    NavDrawerProps,
    NavItem,
    NavSectionHeader,
    NavSubItem,
    NavSubItemGroup,
} from "@fluentui/react-nav-preview";

import {
    makeStyles,
    Label,
    Slider,
    Input,
} from "@fluentui/react-components";
import { bundleIcon, Camera20Filled, Camera20Regular } from "@fluentui/react-icons";

const useStyles = makeStyles({
    root: {
        overflow: "hidden",
        display: "flex",
        height: "800px",
        width: "1200px",
    },
    openButton: {
        flex: "1",
        padding: "16px",
        display: "grid",
        justifyContent: "flex-start",
        alignItems: "flex-start",
        "z-index": "10",
    },
});

import { molvisContext } from "./core";

const CameraIcon = bundleIcon(Camera20Filled, Camera20Regular);

export const SideDrawer = (props: Partial<NavDrawerProps>) => {

    const styles = useStyles();

    const [isOpen, setIsOpen] = useState(true);

    const [cameraFOV, setCameraFOV] = useState(60);

    const molvis = useContext(molvisContext);

    return (
        <div className={styles.root}>
            <NavDrawer
                open={isOpen}
                type="inline"
            >
                <NavDrawerHeader>
                    <NavDrawerHeaderNav>
                        <Hamburger onClick={() => setIsOpen(false)} />
                    </NavDrawerHeaderNav>
                </NavDrawerHeader>

                <NavDrawerBody>
                    <NavSectionHeader>Camera</NavSectionHeader>

                    <NavItem value="1">
                        <Label>FOV: {cameraFOV}</Label>
                        <Slider defaultValue={60} size="medium" min={20} max={100} onChange={(_, data) => {setCameraFOV(data.value); molvis.get_controller().world.camera.fov = data.value}} /> 

                    </NavItem>

                    <NavCategory value="16">
                        <NavCategoryItem icon={<CameraIcon />}>
                            Camera
                        </NavCategoryItem>
                        <NavSubItemGroup>
                            <NavSubItem value="17">
                                <Label>FOV: {cameraFOV}</Label>
                                <Slider defaultValue={60} size="medium" min={20} max={100} onChange={(_, data) => {setCameraFOV(data.value); molvis.get_controller().world.camera.fov = data.value}} />
                            </NavSubItem>
                            <NavSubItem value="18">
                                Angles: <Input placeholder="alpha" /> <Input placeholder="beta" /> <Input placeholder="gamma" />
                            </NavSubItem>
                        </NavSubItemGroup>
                    </NavCategory>
                </NavDrawerBody>

                <NavDrawerFooter>

                </NavDrawerFooter>
            </NavDrawer>

            <div className={styles.openButton}>
                {!isOpen && <Hamburger onClick={() => setIsOpen(true)} />}
            </div>
        </div>
    );
};
