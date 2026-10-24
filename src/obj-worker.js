import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

const MAX_GEOMETRY_BYTES = 256 * 1024 * 1024;
const MAX_VERTICES = 3_000_000;
const MAX_OBJECTS = 10_000;
const MAX_GROUPS = 20_000;

self.onmessage = ({ data }) => {
    try {
        self.postMessage({ type: 'parsing' });
        const started = performance.now();
        const model = new OBJLoader().parse(new TextDecoder().decode(data));
        const parseMs = performance.now() - started;
        const materials = [], objects = [], buffers = new Set(), materialIds = new Map();
        let geometryBytes = 0, vertices = 0, groups = 0;
        const materialId = material => {
            if (!materialIds.has(material)) {
                materialIds.set(material, materials.length);
                materials.push({
                    type: material.type, name: material.name, color: material.color.toArray(),
                    flatShading: !!material.flatShading, vertexColors: material.vertexColors,
                    size: material.size, sizeAttenuation: material.sizeAttenuation,
                });
            }
            return materialIds.get(material);
        };
        for (const child of model.children) {
            const geometry = child.geometry;
            if (!geometry) continue;
            vertices += geometry.attributes.position.count;
            groups += geometry.groups.length;
            if (vertices > MAX_VERTICES || objects.length >= MAX_OBJECTS || groups > MAX_GROUPS) {
                throw new Error('几何体超限（300 万渲染顶点、10000 个对象、20000 个材质分组）');
            }
            const attributes = {};
            for (const [name, attribute] of Object.entries(geometry.attributes)) {
                geometryBytes += attribute.array.byteLength;
                if (geometryBytes > MAX_GEOMETRY_BYTES) throw new Error('几何缓冲区超过 256 MiB');
                if (!attribute.array.every(Number.isFinite)) throw new Error(`模型包含无效 ${name} 坐标`);
                attributes[name] = { array: attribute.array, itemSize: attribute.itemSize, normalized: attribute.normalized };
                buffers.add(attribute.array.buffer);
            }
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            const original = child.material;
            objects.push({
                name: child.name, type: child.type, attributes,
                groups: geometry.groups,
                material: Array.isArray(original) ? original.map(materialId) : materialId(original),
                box: { min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() },
                sphere: { center: geometry.boundingSphere.center.toArray(), radius: geometry.boundingSphere.radius },
            });
        }
        self.postMessage({
            type: 'complete', objects, materials, libraries: model.materialLibraries,
            metrics: { parseMs, workerMs: performance.now() - started, geometryBytes, vertices, objects: objects.length, groups },
        }, [...buffers]);
    } catch (error) {
        self.postMessage({ type: 'error', message: error.message || String(error) });
    }
};
