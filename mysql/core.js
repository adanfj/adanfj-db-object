import mysql2 from 'mysql2/promise';
let client= mysql2.createConnection({
    host:process.env.DB_HOSTNAME,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
});

export const collectionToIndex = (collection, index) => `${collection.toLowerCase()}s_by_${index}`
export const createCollection = async (name) => {
    let collection;
    try {
        await (await client).query(`CREATE TABLE ${name} (id INT PRIMARY KEY AUTO_INCREMENT, data JSON);`);
    } catch (error) {
        // Table already exists, do nothing
    }
    return collection;
}

export const getDocument = async (collection, index, fieldValue) => {
    const [rows] = await (await client).query(`SELECT * FROM ${collection}`);
    return rows.find(r => (typeof r.data=="string"?JSON.parse(r.data):r.data)[index] == fieldValue);
};

export const deleteDocument = async (collection, index, fieldValue) => {
    const document = await getDocument(collection, index, fieldValue)
    await (await client).query(`DELETE FROM ${collection} WHERE id = ${document.id}`);
    return { data: 'Document deleted successfully' };
};

export const createDocument = async (collection,index, data) => {
    const existingDocument = await getDocument(collection,index,data[index])
    if(existingDocument)return existingDocument
    // console.log(`INSERT INTO ${collection} (data) VALUES ('${JSON.stringify(data)}');`)
    await (await client).query(`INSERT INTO ${collection} (data) VALUES (?);`,[JSON.stringify(data)]);
    return { data};
};

export const modifyDocument = async (collection, index, fieldValue, data) => {
    if (!index) throw "No index provided! `index`, `fieldValue` and `data` are required!";
    if (!fieldValue) throw "No value provided! `index`, `fieldValue` and `data` are required!";
    if (!data) throw "No data provided! `index`, `fieldValue` and `data` are required!";
    const document = await getDocument(collection, index, fieldValue)
    await (await client).query(`UPDATE ${collection} SET data = '${JSON.stringify(data)}' WHERE id = ${document.id}`);
    return { data: 'Document modified successfully' };
};

export const getAllDocuments = async (collection) => {
    const [rows] = await (await client).query(`SELECT * FROM ${collection}`);
    return rows;
};

export const mapToRefArray = async (collection, array, field) => {
    const [rows] = await (await client).query(`SELECT id FROM ${collection} WHERE ${field} in (${array.join(',')})`);
    return rows.map(doc => doc.id);
};

export const mapToFieldArray = async (refs) => {
    const [rows] = await (await client).query(`SELECT * FROM ${collection} WHERE id in (${refs.join(',')})`);
    return rows;
};


export class DBCollection {
    constructor(name,index) {
        this.index = index;
        this.name = name;
        
    }
    async create(){
        try {
            await createCollection(this.name)
        } catch (error) {
        }
    }
    async getDocument(value) {
        await this.create();
        return await getDocument(this.name, this.index, value);
    }

    async deleteDocument(value) {
        await this.create();
        return await deleteDocument(this.name, this.index, value);
    }

    async createDocument(data) {
        await this.create();
        return await createDocument(this.name, this.index, data);
    }

    async modifyDocument(value, data) {
        await this.create();
        return await modifyDocument(this.name, this.index, value, data);
    }

    async getAllDocuments() {
        await this.create();
        return await getAllDocuments(this.name);
    }
}

export class DBObject {
    constructor(data, index) {
        this.index = index;
        this.collection = new DBCollection(this.constructor.name, index);
        this.data = data;
        // if(!data||!Object.keys(data).includes(index)||!data[index])console.warn( `data.${index} doesn't exist!`)
        
    }
    async asyncConstructor(save=true,data){
        if(this.data[this.index]==null||this.data[this.index]==undefined)return;
        await this.collection.create();
        if(save) await this.create(save);
        else {
            const doc = await this.collection.getDocument(data[this.index])
            if(doc){
                this.ref=doc.ref;
                this.data = doc.data;
            }
            else this.data=data
        }
        return this;
    }
    async create() {
        if(this.data[this.index]==null||this.data[this.index]==undefined)return;
        let result = await this.collection.createDocument(this.data);
        this.ref = result.ref;
        this.data = result.data;
    }

    async delete() {
        if(this.data[this.index]==null||this.data[this.index]==undefined)return;
        await this.collection.deleteDocument(this.data[this.index]);
    }
    static async fromData(data,save=true){
        const d = new this(data)
        await d.asyncConstructor(save,data)
        return d
    }
    async update(newData) {
        if(this.data[this.index]==null||this.data[this.index]==undefined)return;
        this.data = { ...this.data, ...newData };
        return await this.collection.modifyDocument(this.data[this.index], this.data);
    }
    static async all(){
        const obj = new this()
        return await obj.collection.getAllDocuments()
        
    }

    async addLink(varIndex,value) {
        if(this.data[this.index]==null||this.data[this.index]==undefined)return;
        if(!this.data[varIndex])this.data[varIndex]=[];
        await this.update(Object.fromEntries([[varIndex,[...this.data[varIndex], value.ref]]]));
    }
    async setUniqueLink(varIndex,value) {
        if(this.data[this.index]==null||this.data[this.index]==undefined)return;
        // if(!this.data[varIndex])this.data[varIndex]=[];
        await this.update(Object.fromEntries([[varIndex,value.ref]]));
    }
}