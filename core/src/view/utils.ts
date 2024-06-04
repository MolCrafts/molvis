export const modelname2mesh = (type:string, model_name:string) => {
    return `${type}:${model_name}`;
}

export const mesh2modelname = (mesh_name: string) => {
    const [type, model_name] = mesh_name.split(":");
    return {
        model: type,
        name: model_name
    }
}