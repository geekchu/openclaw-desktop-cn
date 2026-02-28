import Link from 'next/link'

export default function Navigation() {
  return (
    <nav className="flex items-center justify-center gap-3 text-sm text-gray-500 py-8">
      <Link href="/" className="hover:text-[#ef4b58] transition-colors">首页</Link>
      <span className="text-gray-300">|</span>
      <Link href="/showcase" className="hover:text-[#ef4b58] transition-colors">案例展示</Link>
      <span className="text-gray-300">|</span>
      <Link href="/shoutouts" className="hover:text-[#ef4b58] transition-colors">用户好评</Link>
      <span className="text-gray-300">|</span>
      <Link href="/integrations" className="hover:text-[#ef4b58] transition-colors">集成服务</Link>
      <span className="text-gray-300">|</span>
      <Link href="/blog" className="hover:text-[#ef4b58] transition-colors">博客</Link>
    </nav>
  )
}
