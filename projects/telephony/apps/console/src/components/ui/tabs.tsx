/*
 * 中文导读：基础界面组件的 tabs 组件，封装该界面的展示与交互。
 */
"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/src/lib/utils"

function Tabs({
 className,
 orientation = "horizontal",
 ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
 return (
 <TabsPrimitive.Root
 data-slot="tabs"
 data-orientation={orientation}
 orientation={orientation}
 className={cn(
 "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:flex-row",
 className
 )}
 {...props}
 />
 )
}

const tabsListVariants = cva(
 "group/tabs-list inline-flex w-fit shrink-0 items-center justify-center rounded-lg p-1 text-muted-foreground group-data-[orientation=horizontal]/tabs:h-10 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col ",
 {
 variants: {
 variant: {
 default: "bg-muted/70",
 line: "gap-1 bg-transparent",
 },
 },
 defaultVariants: {
 variant: "default",
 },
 }
)

function TabsList({
 className,
 variant = "default",
 ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
 VariantProps<typeof tabsListVariants>) {
 return (
 <TabsPrimitive.List
 data-slot="tabs-list"
 data-variant={variant}
 className={cn(tabsListVariants({ variant }), className)}
 {...props}
 />
 )
}

function TabsTrigger({
 className,
 ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
 return (
 <TabsPrimitive.Trigger
 data-slot="tabs-trigger"
 className={cn(
 "relative inline-flex h-[calc(100%-1px)] flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-md border border-transparent px-3 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-[background-color,color,box-shadow] group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:bg-background/60 hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
 "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent",
 "data-active:bg-background data-active:text-primary data-[state=active]:bg-background data-[state=active]:text-primary dark:data-active:border-input dark:data-[state=active]:border-input dark:data-active:bg-input/30 dark:data-[state=active]:bg-input/30 dark:data-active:text-primary dark:data-[state=active]:text-primary",
 "after:absolute after:bg-primary after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-2 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
 className
 )}
 {...props}
 />
 )
}

function TabsContent({
 className,
 ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
 return (
 <TabsPrimitive.Content
 data-slot="tabs-content"
 className={cn("flex-1 text-sm outline-none", className)}
 {...props}
 />
 )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
