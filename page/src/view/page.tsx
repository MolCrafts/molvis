import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MolvisCore } from "./core"
import { SideDrawer } from "./side";
import "./page.css";

const ViewPage = () => {

    return (
        <>
            <MolvisCore />
            <FluentProvider theme={webLightTheme}>
                <SideDrawer />
            </FluentProvider>
        </>
    )
}

export default ViewPage;