import { usePageTitle } from "../utils/usePageTitle"

export default function NotFound(){
  usePageTitle("EDP | Không tìm thấy")

  return(

    <div className="min-h-screen flex items-center justify-center bg-gray-50">

      <div className="text-center">

        <h1 className="text-6xl font-bold text-[#2e77df] mb-4">
          404
        </h1>

        <p className="text-gray-600 mb-6">
          Trang bạn truy cập không tồn tại
        </p>

        <a
          href="/"
          className="px-6 py-3 bg-[#2e77df] text-white rounded-lg"
        >
          Về trang chủ
        </a>

      </div>

    </div>

  )

}
