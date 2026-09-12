/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { ChevronUp, Search, X } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';

// 严格调用你给我的核心本地 API
import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import ContinueWatching from '@/components/ContinueWatching';
import PageLayout from '@/components/PageLayout';
import { useSite } from '@/components/SiteProvider';
import VideoCard from '@/components/VideoCard';

function HomeClient() {
  const [activeTab, setActiveTab] = useState<'home' | 'favorites'>('home');
  const { announcement } = useSite();
  const [showAnnouncement, setShowAnnouncement] = useState(false);

  // === 搜索页和首页融合的最小完全状态机 ===
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [viewMode, setViewMode] = useState<'agg' | 'all'>('agg');

  // 检查公告弹窗状态
  useEffect(() => {
    if (typeof window !== 'undefined' && announcement) {
      const hasSeenAnnouncement = localStorage.getItem('hasSeenAnnouncement');
      if (hasSeenAnnouncement !== announcement) {
        setShowAnnouncement(true);
      } else {
        setShowAnnouncement(Boolean(!hasSeenAnnouncement && announcement));
      }
    }
  }, [announcement]);
  // 收藏夹内部类型
  type FavoriteItem = {
    id: string;
    source: string;
    title: string;
    poster: string;
    episodes: number;
    source_name: string;
    currentEpisode?: number;
    search_title?: string;
  };
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);

  // 监听载入本地搜索历史与滚动检测
  useEffect(() => {
    getSearchHistory().then(setSearchHistory);

    const unsubscribeHistory = subscribeToDataUpdates(
      'searchHistoryUpdated',
      (newHistory: string[]) => {
        setSearchHistory(newHistory);
      }
    );

    const handleScroll = () => {
      const scrollTop = document.body.scrollTop || document.documentElement.scrollTop || 0;
      setShowBackToTop(scrollTop > 300);
    };

    document.body.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      unsubscribeHistory();
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // 执行 20 个采集站的线上高并发搜索请求
  const fetchSearchResults = async (query: string) => {
    const target = query.trim();
    if (!target) return;
    try {
      setIsLoading(true);
      setShowResults(true);
      const response = await fetch(`/api/search?q=${encodeURIComponent(target)}`);
      const data = await response.json();
      let results = data.results || [];

      if (
        typeof window !== 'undefined' &&
        !(window as any).RUNTIME_CONFIG?.DISABLE_YELLOW_FILTER
      ) {
        results = results.filter((result: SearchResult) => {
          const typeName = result.type_name || '';
          return !yellowWords.some((word: string) => typeName.includes(word));
        });
      }

      setSearchResults(
        results.sort((a: SearchResult, b: SearchResult) => {
          const aExactMatch = a.title === target;
          const bExactMatch = b.title === target;
          if (aExactMatch && !bExactMatch) return -1;
          if (!aExactMatch && bExactMatch) return 1;
          if (a.year === b.year) {
            return a.title.localeCompare(b.title);
          } else {
            if (a.year === 'unknown' && b.year === 'unknown') return 0;
            if (a.year === 'unknown') return 1;
            if (b.year === 'unknown') return -1;
            return parseInt(a.year) > parseInt(b.year) ? -1 : 1;
          }
        })
      );
    } catch (error) {
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;
    fetchSearchResults(trimmed);
    addSearchHistory(trimmed);
  };

  // 严格修正后的聚合分类器，修复二元组的下标定位错误
  const aggregatedResults = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    searchResults.forEach((item) => {
      const key = `${item.title.replaceAll(' ', '')}-${
        item.year || 'unknown'
      }-${item.episodes.length === 1 ? 'movie' : 'tv'}`;
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    });
    return Array.from(map.entries()).sort((a, b) => {
      const aExactMatch = a[1][0].title.replaceAll(' ', '').includes(searchQuery.trim().replaceAll(' ', ''));
      const bExactMatch = b[1][0].title.replaceAll(' ', '').includes(searchQuery.trim().replaceAll(' ', ''));
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;
      if (a[1][0].year === b[1][0].year) {
        return a[0].localeCompare(b[0]);
      } else {
        const aYear = a[1][0].year;
        const bYear = b[1][0].year;
        if (aYear === 'unknown' && bYear === 'unknown') return 0;
        if (aYear === 'unknown') return 1;
        if (bYear === 'unknown') return -1;
        return aYear > bYear ? -1 : 1;
      }
    });
  }, [searchResults, searchQuery]);

  // 同步收藏夹记录
  const updateFavoriteItems = async (allFavorites: Record<string, any>) => {
    const allPlayRecords = await getAllPlayRecords();
    const sorted = Object.entries(allFavorites)
      .sort(([, a], [, b]) => b.save_time - a.save_time)
      .map(([key, fav]) => {
        const plusIndex = key.indexOf('+');
        const source = key.slice(0, plusIndex);
        const id = key.slice(plusIndex + 1);
        const playRecord = allPlayRecords[key];
        const currentEpisode = playRecord?.index;

        return {
          id,
          source,
          title: fav.title,
          year: fav.year,
          poster: fav.cover,
          episodes: fav.total_episodes,
          source_name: fav.source_name,
          currentEpisode,
          search_title: fav?.search_title,
        } as FavoriteItem;
      });
    setFavoriteItems(sorted);
  };

  useEffect(() => {
    if (activeTab !== 'favorites') return;
    getAllFavorites().then(updateFavoriteItems);
    return subscribeToDataUpdates('favoritesUpdated', updateFavoriteItems);
  }, [activeTab]);

  const handleCloseAnnouncement = (announcement: string) => {
    setShowAnnouncement(false);
    localStorage.setItem('hasSeenAnnouncement', announcement);
  };

  return (
    <PageLayout>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-10'>
        
        {/* 1. 顶部无跳转原生搜索框结构 */}
        <div className='mb-8'>
          <form onSubmit={handleSearch} className='max-w-2xl mx-auto'>
            <div className='relative'>
              <Search className='absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500' />
              <input
                id='searchInput'
                type='text'
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!e.target.value.trim()) setShowResults(false);
                }}
                placeholder='在此直接搜索电影、电视剧，海报100%全显...'
                className='w-full h-12 rounded-lg bg-gray-50/80 py-3 pl-10 pr-4 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 focus:bg-white border border-gray-200/50 shadow-sm dark:bg-gray-800 dark:text-gray-300'
              />
            </div>
          </form>
        </div>

        {/* 2. 标签切换器 */}
        <div className='mb-8 flex justify-center'>
          <CapsuleSwitch
            options={[
              { label: '首页', value: 'home' },
              { label: '收藏夹', value: 'favorites' },
            ]}
            active={activeTab}
            onChange={(value) => setActiveTab(value as 'home' | 'favorites')}
          />
        </div>
        <div className='max-w-[95%] mx-auto mt-12 overflow-visible'>
          {activeTab === 'favorites' ? (
            // 收藏夹视图
            <section className='mb-12'>
              <div className='mb-4 flex items-center justify-between'>
                <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>我的收藏</h2>
                {favoriteItems.length > 0 && (
                  <button
                    className='text-sm text-gray-500 hover:text-red-500'
                    onClick={async () => {
                      await clearAllFavorites();
                      setFavoriteItems([]);
                    }}
                  >
                    清空
                  </button>
                )}
              </div>
              <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
                {favoriteItems.map((item) => (
                  <div key={item.id + item.source} className='w-full'>
                    <VideoCard
                      query={item.search_title}
                      {...item}
                      from='favorite'
                      type={item.episodes > 1 ? 'tv' : ''}
                    />
                  </div>
                ))}
                {favoriteItems.length === 0 && (
                  <div className='col-span-full text-center text-gray-500 py-8 dark:text-gray-400'>暂无收藏内容</div>
                )}
              </div>
            </section>
          ) : (
            // 完美的首页双向缝合流视图
            <>
              {/* 继续观看优先显示 */}
              <ContinueWatching />

              {/* 当触发搜索时，结果直接平铺展示在下方 */}
              <div className='mt-12 overflow-visible'>
                {isLoading ? (
                  <div className='flex justify-center items-center h-40'>
                    <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
                  </div>
                ) : showResults ? (
                  <section className='mb-12'>
                    <div className='mb-8 flex items-center justify-between'>
                      <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>搜索结果</h2>
                      <label className='flex items-center gap-2 cursor-pointer select-none'>
                        <span className='text-sm text-gray-700 dark:text-gray-300'>聚合</span>
                        <div className='relative'>
                          <input
                            type='checkbox'
                            className='sr-only peer'
                            checked={viewMode === 'agg'}
                            onChange={() => setViewMode(viewMode === 'agg' ? 'all' : 'agg')}
                          />
                          <div className='w-9 h-5 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                          <div className='absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4'></div>
                        </div>
                      </label>
                    </div>

                    <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
                      {viewMode === 'agg'
                        ? aggregatedResults.map(([mapKey, group]) => (
                            <div key={`agg-${mapKey}`} className='w-full'>
                              <VideoCard
                                from='search'
                                items={group}
                                query={searchQuery.trim() !== group[0].title ? searchQuery.trim() : ''}
                              />
                            </div>
                          ))
                        : searchResults.map((item) => (
                            <div key={`all-${item.source}-${item.id}`} className='w-full'>
                              <VideoCard
                                id={item.id}
                                title={item.title + ' ' + item.type_name}
                                poster={item.poster}
                                episodes={item.episodes.length}
                                source={item.source}
                                source_name={item.source_name}
                                douban_id={item.douban_id?.toString()}
                                query={searchQuery.trim() !== item.title ? searchQuery.trim() : ''}
                                year={item.year}
                                from='search'
                                type={item.episodes.length > 1 ? 'tv' : 'movie'}
                              />
                            </div>
                          ))}
                      {searchResults.length === 0 && (
                        <div className='col-span-full text-center text-gray-500 py-8 dark:text-gray-400'>
                          未找到相关结果
                        </div>
                      )}
                    </div>
                  </section>
                ) : searchHistory.length > 0 ? (
                  // 本地搜索历史展示
                  <section className='mb-12'>
                    <h2 className='mb-4 text-xl font-bold text-gray-800 text-left dark:text-gray-200'>
                      搜索历史
                      <button
                        onClick={() => clearSearchHistory()}
                        className='ml-3 text-sm text-gray-500 hover:text-red-500 transition-colors dark:text-gray-400'
                      >
                        清空
                      </button>
                    </h2>
                    <div className='flex flex-wrap gap-2'>
                      {searchHistory.map((item) => (
                        <div key={item} className='relative group'>
                          <button
                            onClick={() => {
                              setSearchQuery(item);
                              fetchSearchResults(item);
                            }}
                            className='px-4 py-2 bg-gray-500/10 hover:bg-gray-300 rounded-full text-sm text-gray-700 transition-colors duration-200 dark:bg-gray-700/50 dark:text-gray-300'
                          >
                            {item}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteSearchHistory(item);
                            }}
                            className='absolute -top-1 -right-1 w-4 h-4 bg-gray-400 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-[10px]'
                          >
                            <X className='w-3 h-3' />
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : (
                  <div className='text-center text-gray-400 py-12 text-sm dark:text-gray-600'>
                    💡 输入你想看的片名，国内20个超级采集站将同时无痕为你拉满检索
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 公告信息 */}
      {announcement && showAnnouncement && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4'>
          <div className='w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900'>
            <div className='flex justify-between items-start mb-4'>
              <h3 className='text-2xl font-bold text-gray-800 dark:text-white border-b border-green-500 pb-1'>提示</h3>
            </div>
            <div className='mb-6'>
              <div className='relative overflow-hidden rounded-lg mb-4 bg-green-50 dark:bg-green-900/20 p-3'>
                <p className='text-gray-600 dark:text-gray-300 leading-relaxed'>{announcement}</p>
              </div>
            </div>
            <button
              onClick={() => handleCloseAnnouncement(announcement)}
              className='w-full rounded-lg bg-green-600 px-4 py-3 text-white font-medium hover:bg-green-700 transition-colors'
            >
              我知道了
            </button>
          </div>
        </div>
      )}

      {/* 返回顶部悬浮按钮 */}
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className={`fixed bottom-6 right-6 z- w-12 h-12 bg-green-500/90 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-300 ${
          showBackToTop ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
      >
        <ChevronUp className='w-6 h-6' />
      </button>
    </PageLayout>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeClient />
    </Suspense>
  );
}
