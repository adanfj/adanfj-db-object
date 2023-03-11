const faunadb = require("faunadb")
var q = faunadb.query
let client = new faunadb.Client({ 
    domain:process.env.DB_HOSTNAME,
    port:8443,
    scheme:"http",
    secret: process.env.FAUNADB_SECRET 
});
export const collectionToIndex = (collection, index) => `${collection.toLowerCase()}s_by_${index}`
export const createCollection = async (name, index) => {
    let collection;
    try {
        collection = await client.query(q.CreateCollection({ name }));
    } catch (error) {
        // Collection already exists, do nothing
    }
    try {
        await client.query(
            q.CreateIndex({
                name: collectionToIndex(name, index),
                source: q.Collection(name),
                unique: true,
                terms: [
                    { field: ["data", index] },
                ],
                values: [
                    { field: ["ref"] },
                ],
            }),
        );
    } catch (error) {
        // Index already exists, do nothing
    }
    return collection;
}

export const getDocument = async (collection, index, fieldValue) => {
    const ref = await client.query(
        q.Paginate(
            q.Match(q.Index(collectionToIndex(collection, index)), fieldValue),
        ),
    )
    if (ref.data[0]) {
        const id = ref.data[0].id
        return await client.query(
            q.Get(q.Ref(q.Collection(collection), id))
        )
    }
    return null
};

export const deleteDocument = async (collection, index, fieldValue) =>
    (client.query(q.Delete((await getDocument(collection, index, fieldValue)).ref))).data


export const createDocument = async (collection, index, data) => {
    const existingDocument = await getDocument(collection, index, data[index])
    if (existingDocument) return existingDocument;
    const toret = (await client.query(
        q.Create(
            q.Collection(collection),
            { data },
        ),
    ))
    return toret
}

export const modifyDocument = async (collection, index, fieldValue, data) => {
    if (!index) throw "No index provided! `index`, `fieldValue` and `data` are required!"
    if (!fieldValue) throw "No value provided! `index`, `fieldValue` and `data` are required!"
    if (!data) throw "No data provided! `index`, `fieldValue` and `data` are required!"
    const doc = await getDocument(collection, index, fieldValue)
    if (doc) return (await client.query(
        q.Update(
            doc.ref,
            { data }
        )
    ));
    return doc;
}

export const getAllDocuments = async (collection) => await Promise.all(
    (await client.query(q.Paginate(q.Documents(q.Collection(collection))))).data
        .map(async ref => await client.query(
            q.Get(ref)
        ))
)

export const mapToRefArray = async (collection, array, field) => await Promise.all((await getAllDocuments(collection)).filter(d => array.includes(d.data[field])).map(d => d.ref))
export const mapToFieldArray = async (refs) => await Promise.all(refs.map(async ref => (await client.query(q.Get(ref)))))

export class DBCollection {
    constructor(name,index) {
        this.index = index;
        this.name = name;
        
    }
    async create(){
        try {
            await client.query(q.CreateCollection({ name:this.name }))
        } catch (error) {
        }
        // console.log("Creating index",collectionToIndex(this.name, this.index))
        try {
            await client.query(
                q.CreateIndex({
                    name: collectionToIndex(this.name, this.index),
                    source: q.Collection(this.name),
                    unique: true,
                    terms: [
                        { field: ["data", this.index] },
                    ],
                    values: [
                        { field: ["ref"] },
                    ],
                }),
            )
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

    async mapToRefArray(array, field) {
        return await mapToRefArray(this.name, array, field);
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