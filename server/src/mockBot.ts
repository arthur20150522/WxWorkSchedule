
export class MockBot {
    public isLoggedIn: boolean = true;
    public name: string = 'MockBot';

    constructor(name: string) {
        this.name = name;
    }

    // Mock currentUser
    public get currentUser() {
        return {
            name: () => 'Test User',
            id: 'wxid_testuser123'
        };
    }

    // Mock Room
    public get Room() {
        const rooms = [
            {
                id: 'room_001',
                topic: async () => '产品研发部',
                memberAll: async () => new Array(15), // Mock 15 members
                say: async (text: string) => console.log(`[MockBot] Room(room_001) say: ${text}`)
            },
            {
                id: 'room_002',
                topic: async () => '周末约球群',
                memberAll: async () => new Array(8),
                say: async (text: string) => console.log(`[MockBot] Room(room_002) say: ${text}`)
            },
            {
                id: 'room_003',
                topic: async () => '家庭群',
                memberAll: async () => new Array(6),
                say: async (text: string) => console.log(`[MockBot] Room(room_003) say: ${text}`)
            },
            {
                id: 'room_004',
                topic: async () => '测试报警群',
                memberAll: async () => new Array(3),
                say: async (text: string) => console.log(`[MockBot] Room(room_004) say: ${text}`)
            }
        ];

        return {
            findAll: async () => {
                return rooms;
            },
            find: async (query: any) => {
                if (query.id) {
                    return rooms.find(r => r.id === query.id);
                }
                if (query.topic) {
                    for (const room of rooms) {
                        if (await room.topic() === query.topic) {
                            return room;
                        }
                    }
                }
                return null;
            }
        };
    }

    // Mock Contact
    public get Contact() {
        const contacts = [
            {
                id: 'contact_001',
                name: () => '张三',
                friend: () => true,
                type: () => 1, // Unknown/Personal
                say: async (text: string) => console.log(`[MockBot] Contact(contact_001) say: ${text}`)
            },
            {
                id: 'contact_002',
                name: () => '李四',
                friend: () => true,
                type: () => 1,
                say: async (text: string) => console.log(`[MockBot] Contact(contact_002) say: ${text}`)
            },
            {
                id: 'contact_003',
                name: () => '文件传输助手',
                friend: () => true,
                type: () => 1,
                say: async (text: string) => console.log(`[MockBot] Contact(contact_003) say: ${text}`)
            },
            {
                id: 'contact_004',
                name: () => '王五 (非好友)',
                friend: () => false,
                type: () => 1,
                say: async (text: string) => console.log(`[MockBot] Contact(contact_004) say: ${text}`)
            }
        ];

        return {
            findAll: async () => {
                return contacts;
            },
            find: async (query: any) => {
                if (query.id) {
                    return contacts.find(c => c.id === query.id);
                }
                if (query.name) {
                    for (const contact of contacts) {
                        if (contact.name() === query.name) {
                            return contact;
                        }
                    }
                }
                return null;
            }
        };
    }

    // Event listeners - do nothing
    public on(event: string, listener: (...args: any[]) => void) {
        return this;
    }

    // Lifecycle
    public async start() {
        console.log('[MockBot] Started');
    }

    public async stop() {
        console.log('[MockBot] Stopped');
    }
}
