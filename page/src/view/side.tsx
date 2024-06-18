import { useState, useContext } from "react";
import {
    Hamburger,
    NavDrawer,
    NavDrawerBody,
    NavDrawerFooter,
    NavDrawerHeader,
    NavDrawerHeaderNav,
    NavDrawerProps
} from "@fluentui/react-nav-preview";

import {
    makeStyles,
    Tab,
    TabList,
} from "@fluentui/react-components";
import { bundleIcon, Camera20Filled, Camera20Regular, Dismiss20Filled, Dismiss20Regular } from "@fluentui/react-icons";

const useStyles = makeStyles({
    sideDrawer: {
        top: "0",
        right: "0",
        position: "absolute",
        width: "20%",
        height: "100%"
    },
    openButton: {
        flex: "1",
        padding: "16px",
        display: "grid",
        justifyContent: "flex-start",
        alignItems: "flex-start",
        position: "absolute"
    },
});

import { molvisContext } from "./core";

const CameraIcon = bundleIcon(Camera20Filled, Camera20Regular);
const CloseIcon = bundleIcon(Dismiss20Filled, Dismiss20Regular);

export const SideDrawer = (props: Partial<NavDrawerProps>) => {

    const styles = useStyles();

    const [isOpen, setIsOpen] = useState(true);

    const [cameraFOV, setCameraFOV] = useState(60);

    const molvis = useContext(molvisContext);

    return (
        <>
            <NavDrawer
                open={isOpen}
                type="inline"
                className={styles.sideDrawer}
            >
                <NavDrawerHeader>
                    <NavDrawerHeaderNav>
                        <TabList defaultSelectedValue="1">
                            <Tab value='closeTab'>
                                <CloseIcon onClick={() => setIsOpen(false)} />
                            </Tab>
                            <Tab value='1' >
                                <Hamburger />
                            </Tab>
                            <Tab value='2'>
                                <CameraIcon />
                            </Tab>
                        </TabList>
                    </NavDrawerHeaderNav>

                </NavDrawerHeader>

                <NavDrawerBody>

                </NavDrawerBody>

                <NavDrawerFooter>

                </NavDrawerFooter>
            </NavDrawer>

            <div className={styles.openButton}>
                {!isOpen && <Hamburger onClick={() => setIsOpen(true)} />}
            </div>
        </>
    );
};
