import { useState, useRef, useEffect } from "react"

type ClassType = {
  id:number
  name:string
}

type Props = {
  classes: ClassType[]
  value: string
  onChange: (v:string)=>void
}

export default function ClassSelector({classes,value,onChange}:Props){

  const [query,setQuery] = useState("")
  const [open,setOpen] = useState(false)
  const [index,setIndex] = useState(0)

  const listRef = useRef<HTMLDivElement>(null)

  const filtered = classes.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(()=>{

    const list = listRef.current
    if(!list) return

    const item = list.children[index] as HTMLElement
    if(!item) return

    item.scrollIntoView({
      block:"nearest"
    })

  },[index])

  function handleKey(e:React.KeyboardEvent){

    if(!open) return

    if(e.key==="ArrowDown"){
      e.preventDefault()
      setIndex(i => Math.min(i+1, filtered.length-1))
    }

    if(e.key==="ArrowUp"){
      e.preventDefault()
      setIndex(i => Math.max(i-1,0))
    }

    if(e.key==="Enter"){
      e.preventDefault()

      const c = filtered[index]

      if(c){
        onChange(c.name)
        setQuery("")
        setOpen(false)
      }
    }

  }

  return(

    <div className="relative">

      <input
        className="w-full p-3 border rounded-lg"
        placeholder="Chọn lớp"
        value={value || query}
        onFocus={()=>setOpen(true)}
        onKeyDown={handleKey}
        onChange={e=>{
          setQuery(e.target.value)
          setIndex(0)
          onChange("")
        }}
      />

      {open && (

        <div
          ref={listRef}
          className="absolute z-50 bg-white border rounded-lg w-full max-h-60 overflow-y-auto mt-1 shadow-lg"
        >

          {filtered.map((c,i)=>(

            <div
              key={c.id}
              className={`p-3 cursor-pointer ${
                i===index
                  ? "bg-blue-100"
                  : "hover:bg-gray-100"
              }`}
              onClick={()=>{
                onChange(c.name)
                setQuery("")
                setOpen(false)
              }}
            >
              {c.name}
            </div>

          ))}

        </div>

      )}

    </div>

  )

}