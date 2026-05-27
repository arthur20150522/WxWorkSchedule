export class MockBot {
    public isLoggedIn: boolean = true;
    public name: string = 'wx4py-mock';

    constructor(_name: string) {}

    public get currentUser() {
        return { name: () => 'Test User', id: 'wx4py_mock_user' };
    }

    public get Room() {
        const rooms = [
            { id: 'room_001', topic: async () => '产品研发部', memberAll: async () => new Array(15), say: async (text: string) => console.log(`[Mock] Room(room_001): ${text}`) },
            { id: 'room_002', topic: async () => '周末约球群', memberAll: async () => new Array(8), say: async (text: string) => console.log(`[Mock] Room(room_002): ${text}`) },
            { id: 'room_003', topic: async () => '家庭群', memberAll: async () => new Array(6), say: async (text: string) => console.log(`[Mock] Room(room_003): ${text}`) },
            { id: 'room_004', topic: async () => '测试报警群', memberAll: async () => new Array(3), say: async (text: string) => console.log(`[Mock] Room(room_004): ${text}`) },
        ];
        return {
            findAll: async () => rooms,
            find: async (query: any) => {
                for (const room of rooms) {
                    if (room.id === query.id) return room;
                    if (query.topic && (await room.topic()) === query.topic) return room;
                }
                return null;
            },
        };
    }

    public get Contact() {
        const contacts = [
            { id: 'contact_001', name: () => '张三', friend: () => true, type: () => 1, say: async (text: string) => console.log(`[Mock] Contact(张三): ${text}`) },
            { id: 'contact_002', name: () => '李四', friend: () => true, type: () => 1, say: async (text: string) => console.log(`[Mock] Contact(李四): ${text}`) },
            { id: 'contact_003', name: () => '文件传输助手', friend: () => true, type: () => 1, say: async (text: string) => console.log(`[Mock] Contact(文件传输助手): ${text}`) },
        ];
        return {
            findAll: async () => contacts,
            find: async (query: any) => {
                for (const c of contacts) {
                    if (c.id === query.id) return c;
                    if (query.name && c.name() === query.name) return c;
                }
                return null;
            },
        };
    }

    public on(_event: string, _listener: (...args: any[]) => void) { return this; }
    public async start() { console.log('[MockBot] Started'); }
    public async stop() { console.log('[MockBot] Stopped'); }
}
